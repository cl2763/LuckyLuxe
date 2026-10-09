// Approved free solo policy. Runtime resolution only: no plan/tenant/history migration.
// Acquisition limits are configuration; self-onboarding remains disabled until every
// creation/publish path has enforcement and concurrent-boundary coverage.
export const FREE_PERSONAL_POLICY = Object.freeze({
  features: Object.freeze(['booking', 'crm', 'gallery', 'reports']),
  limits: Object.freeze({maxStores:1,maxStaff:1,maxServices:20,maxOrdersPerMonth:100,maxPublicWorks:30,maxStorageMb:500,aiMessagesPerMonth:0})
})
export function effectivePlanPolicy(planId, features, limits) {
  return planId === 'free' ? { features:[...FREE_PERSONAL_POLICY.features], limits:{...limits,...FREE_PERSONAL_POLICY.limits} } : {features,limits}
}
