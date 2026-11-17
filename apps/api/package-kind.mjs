// Read compatibility only: never migrate or recreate merchants' existing packages.
export const isRechargePackage = row => row?.kind === 'recharge' || row?.kind === 'stored_value'
export const canonicalPackageKind = kind => kind === 'stored_value' ? 'recharge' : kind
