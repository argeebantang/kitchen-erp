import { Prisma, Role, type BranchType } from '@prisma/client'
import { BranchRepository, BranchWithManager } from '@/repositories/branch.repository'
import { UserRepository } from '@/repositories/user.repository'

export type BranchDto = {
  id: string
  code: string
  name: string
  type: BranchType
  address: string | null
  phone: string | null
  manager: { id: string; name: string; email: string } | null
  isActive: boolean
}

export type CreateBranchServiceInput = {
  code: string
  name: string
  type: BranchType
  address?: string | null
  phone?: string | null
  /** A BRANCH_MANAGER user; null for none. Absent on an edit leaves it unchanged. */
  managerId?: string | null
}

export type UpdateBranchServiceInput = Partial<Omit<CreateBranchServiceInput, 'code'>>

export type BranchResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

const DUPLICATE = 'A branch with that name or code already exists'
const MANAGER_TAKEN = 'That manager was just assigned to another branch — reload and try again'

function toDto(branch: BranchWithManager): BranchDto {
  return {
    id:       branch.id,
    code:     branch.code,
    name:     branch.name,
    type:     branch.type,
    address:  branch.address,
    phone:    branch.phone,
    manager:  branch.manager,
    isActive: branch.isActive,
  }
}

/** Blank optional text is stored as null, not ''. */
function blankToNull(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : (value?.trim() || null)
}

/**
 * The unique indexes on name and code are the last word: two admins saving
 * the same name at once both pass the pre-check, and the second insert fails
 * here instead of becoming a 500.
 */
function uniqueViolation(err: unknown): string | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return null
  return String(err.meta?.target ?? '').includes('managerId') ? MANAGER_TAKEN : DUPLICATE
}

/** Only a branch-manager user can run a branch. */
async function checkManager(managerId: string | null | undefined): Promise<string | null> {
  if (!managerId) return null
  const user = await UserRepository.findById(managerId)
  if (!user) return 'Manager not found'
  if (user.role !== Role.BRANCH_MANAGER) return `${user.name} is not a branch manager`
  return null
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "4 production orders (PRD-000001, PRD-000002, PRD-000003, …)" */
function documents(open: { total: number; numbers: string[] }, one: string): string | null {
  if (open.total === 0) return null
  const more = open.total > open.numbers.length ? ', …' : ''
  return `${plural(open.total, one)} (${open.numbers.join(', ')}${more})`
}

/** Branch profiles (Week 8 Task 1), managed from Master Data by ADMIN. */
export const BranchService = {
  async list(includeInactive = false): Promise<BranchDto[]> {
    const branches = await BranchRepository.findAll(includeInactive)
    return branches.map(toDto)
  },

  async create(input: CreateBranchServiceInput): Promise<BranchResult<BranchDto>> {
    const code = input.code.trim().toUpperCase()
    const name = input.name.trim()

    if (await BranchRepository.existsByCode(code)) {
      return { success: false, error: `Code ${code} is already used by another branch`, status: 409 }
    }
    if (await BranchRepository.existsByName(name)) {
      return { success: false, error: `A branch named "${name}" already exists`, status: 409 }
    }
    const managerError = await checkManager(input.managerId)
    if (managerError) {
      return { success: false, error: managerError, status: 400 }
    }

    try {
      const branch = await BranchRepository.create({
        code,
        name,
        type:    input.type,
        address: blankToNull(input.address) ?? null,
        phone:   blankToNull(input.phone) ?? null,
        managerId: input.managerId ?? null,
      })
      return { success: true, data: toDto(branch) }
    } catch (err) {
      const clash = uniqueViolation(err)
      if (clash) return { success: false, error: clash, status: 409 }
      throw err
    }
  },

  /** The code is fixed once created, so it is not editable here (B1). */
  async update(id: string, input: UpdateBranchServiceInput): Promise<BranchResult<BranchDto>> {
    const current = await BranchRepository.findProfile(id)
    if (!current) {
      return { success: false, error: 'Branch not found', status: 404 }
    }

    const name = input.name?.trim()
    if (name !== undefined && await BranchRepository.existsByName(name, id)) {
      return { success: false, error: `A branch named "${name}" already exists`, status: 409 }
    }
    const managerError = await checkManager(input.managerId)
    if (managerError) {
      return { success: false, error: managerError, status: 400 }
    }

    // Some active branch must stay a commissary — transfers start from one (B3).
    const keepACommissary = current.isActive && current.type === 'COMMISSARY' && input.type === 'OUTLET'

    try {
      const updated = await BranchRepository.update(id, {
        name,
        type:    input.type,
        address: blankToNull(input.address),
        phone:   blankToNull(input.phone),
        managerId: input.managerId,
      }, keepACommissary)

      if (updated === null) {
        return { success: false, error: 'Branch not found', status: 404 }
      }
      if (updated === 'LAST_COMMISSARY') {
        return {
          success: false,
          error:   `${current.name} is the only active commissary — make another branch a commissary first`,
          status:  409,
        }
      }
      return { success: true, data: toDto(updated) }
    } catch (err) {
      const clash = uniqueViolation(err)
      if (clash) return { success: false, error: clash, status: 409 }
      throw err
    }
  },

  /**
   * Never a delete: documents and ledgers keep pointing at the branch. Refused
   * while it holds stock or has open documents (B3) — every inventory page
   * lists active branches only, so that stock would vanish from view — and
   * when it is the last active commissary. The message says what to clear.
   */
  async deactivate(id: string): Promise<BranchResult<BranchDto>> {
    const current = await BranchRepository.findProfile(id)
    if (!current) {
      return { success: false, error: 'Branch not found', status: 404 }
    }
    if (!current.isActive) {
      return { success: false, error: `${current.name} is already inactive`, status: 409 }
    }

    const blockers = await BranchRepository.deactivationBlockers(id)
    const stock = [
      blockers.materialLevels   > 0 ? plural(blockers.materialLevels, 'raw material') : null,
      blockers.finishedGoodLots > 0 ? plural(blockers.finishedGoodLots, 'finished-goods lot') : null,
    ].filter(part => part !== null)
    const open = [
      documents(blockers.productionOrders, 'production order'),
      documents(blockers.receivingReports, 'receiving report'),
      documents(blockers.conversionOrders, 'conversion'),
      documents(blockers.writeOffs,        'write-off'),
    ].filter(part => part !== null)

    if (stock.length > 0 || open.length > 0) {
      const reasons = [
        stock.length > 0 ? `it still holds stock — ${stock.join(', ')}` : null,
        open.length  > 0 ? `it has open documents — ${open.join(', ')}` : null,
      ].filter(part => part !== null)
      const todo = [
        stock.length > 0 ? 'move or use up the stock' : null,
        open.length  > 0 ? 'finish or cancel the documents' : null,
      ].filter(part => part !== null).join(' and ')
      return {
        success: false,
        error:   `${current.name} can't be deactivated: ${reasons.join('; and ')}. To deactivate it, ${todo} first.`,
        status:  409,
      }
    }

    const result = await BranchRepository.setActive(id, false, current.type === 'COMMISSARY')
    if (result === 'LAST_COMMISSARY') {
      return {
        success: false,
        error:   `${current.name} is the only active commissary — make another branch a commissary first`,
        status:  409,
      }
    }
    if (result === 'UNCHANGED') {
      return { success: false, error: `${current.name} is already inactive`, status: 409 }
    }
    return { success: true, data: toDto(result) }
  },

  async reactivate(id: string): Promise<BranchResult<BranchDto>> {
    const current = await BranchRepository.findProfile(id)
    if (!current) {
      return { success: false, error: 'Branch not found', status: 404 }
    }

    const result = await BranchRepository.setActive(id, true, false)
    if (result === 'UNCHANGED' || result === 'LAST_COMMISSARY') {
      return { success: false, error: `${current.name} is already active`, status: 409 }
    }
    return { success: true, data: toDto(result) }
  },
}
