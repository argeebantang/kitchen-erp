import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // `next lint` defaults to app/, pages/, components/, lib/ and src/ only —
    // which silently skips repositories/ and services/, where most of this
    // project's logic lives (see docs/architecture.md). Listed explicitly so
    // CI actually lints those layers.
    dirs: ['app', 'components', 'lib', 'hooks', 'repositories', 'services', 'prisma'],
  },
};

export default nextConfig;
