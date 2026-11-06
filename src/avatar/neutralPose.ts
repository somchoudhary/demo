import { Object3D, Quaternion, Vector3 } from 'three'

/**
 * Relax the authored MPFB A-pose using its existing skeleton. This only rotates
 * bones; it does not synthesize or replace any anatomy. Custom avatars keep their
 * authored pose unless they explicitly opt into this known rig convention.
 */
export function applyMpfbNeutralPose(root: Object3D): void {
  root.updateMatrixWorld(true)
  const aim = (boneName: string, childName: string, direction: Vector3) => {
    const bone = root.getObjectByName(boneName)
    const child = root.getObjectByName(childName)
    if (!bone || !child || !bone.parent) return
    const current = child.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3())).normalize()
    if (current.lengthSq() === 0) return
    const delta = new Quaternion().setFromUnitVectors(current, direction.normalize())
    const world = bone.getWorldQuaternion(new Quaternion())
    const parentWorld = bone.parent.getWorldQuaternion(new Quaternion())
    bone.quaternion.copy(parentWorld.invert().multiply(delta.multiply(world)))
    bone.updateMatrixWorld(true)
  }

  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    aim(`${side}Arm`, `${side}ForeArm`, new Vector3(sign * 0.18, -0.98, 0.03))
    aim(`${side}ForeArm`, `${side}Hand`, new Vector3(sign * 0.07, -0.97, 0.22))
  }
  root.updateMatrixWorld(true)
}
