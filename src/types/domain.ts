export type UnitDraft = { id: string; name: string; position: number }
export type FloorDraft = { id: string; name: string; floorNumber: number; unitCount: number; units: UnitDraft[] }
export type BuildingSetup = { id: string; name: string; floors: FloorDraft[] }
