// Three's MMDPhysics has no disposal API. This module owns its native world
// and releases the Ammo handles retained by the current Three adapter.
type Native = object
type World = { removeRigidBody(body: Native): void; removeConstraint(constraint: Native): void }
type Ammo = {
  destroy(value: Native): void
  btDefaultCollisionConfiguration: new () => Native
  btCollisionDispatcher: new (config: Native) => Native
  btDbvtBroadphase: new () => Native
  btSequentialImpulseConstraintSolver: new () => Native
  btDiscreteDynamicsWorld: new (dispatcher: Native, broadphase: Native, solver: Native, config: Native) => World
}
export type PhysicsResources = {
  world: World
  constraints: Array<{ constraint: Native }>
  bodies: Array<{ body: Native & { getMotionState(): Native; getCollisionShape(): Native }; boneOffsetForm: Native; boneOffsetFormInverse: Native }>
  manager: { transforms: Native[]; quaternions: Native[]; vector3s: Native[] }
}

export function createMmdWorld(runtime: unknown): { world: World; dispose(physics?: PhysicsResources): void } {
  const ammo = runtime as Ammo
  const config = new ammo.btDefaultCollisionConfiguration()
  const dispatcher = new ammo.btCollisionDispatcher(config)
  const broadphase = new ammo.btDbvtBroadphase()
  const solver = new ammo.btSequentialImpulseConstraintSolver()
  const world = new ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, config)
  let disposed = false
  return { world, dispose(physics) {
    if (disposed) return
    disposed = true
    const freed = new Set<Native>()
    const destroy = (value: Native): void => { if (value && !freed.has(value)) { freed.add(value); ammo.destroy(value) } }
    if (physics) {
      for (const item of physics.constraints) { world.removeConstraint(item.constraint); destroy(item.constraint) }
      for (const item of physics.bodies) {
        world.removeRigidBody(item.body)
        const state = item.body.getMotionState()
        const shape = item.body.getCollisionShape()
        destroy(item.body); destroy(state); destroy(shape)
        destroy(item.boneOffsetForm); destroy(item.boneOffsetFormInverse)
      }
      for (const handles of [physics.manager.transforms, physics.manager.quaternions, physics.manager.vector3s]) handles.forEach(destroy)
    }
    destroy(world); destroy(solver); destroy(broadphase); destroy(dispatcher); destroy(config)
  } }
}
