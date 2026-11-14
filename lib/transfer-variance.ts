/**
 * Why a transfer arrived short (Week 8 Task 4, V4), with the labels people
 * see. Runtime-neutral — no Prisma import, no 'use client' — so the receipt
 * form, the transfer page and the notifications share one list. The values
 * match the TransferVarianceReason enum in prisma/schema.prisma.
 */
export const TRANSFER_VARIANCE_REASONS = [
  { value: 'DAMAGED', label: 'Damaged / spilled' },
  { value: 'SPOILED', label: 'Spoiled' },
  { value: 'MISSING', label: 'Missing' },
  { value: 'OTHER',   label: 'Other' },
] as const

export type TransferVarianceReasonValue = (typeof TRANSFER_VARIANCE_REASONS)[number]['value']

export function isTransferVarianceReason(value: string): value is TransferVarianceReasonValue {
  return TRANSFER_VARIANCE_REASONS.some(reason => reason.value === value)
}

export function transferVarianceReasonLabel(value: string): string {
  return TRANSFER_VARIANCE_REASONS.find(reason => reason.value === value)?.label ?? value
}
