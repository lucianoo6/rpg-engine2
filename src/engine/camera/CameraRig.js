import * as THREE from 'three';
import { damp } from '../core/Random.js';
import { globalUniforms } from '../render/MaterialPatch.js';

const DEG = Math.PI / 180;

/**
 * The diorama camera: long lens, fixed downward pitch, smooth follow with a
 * little look-ahead, optional yaw orbit and zoom, and scripted moves.
 */
export class CameraRig {
  constructor(camera, { distance = 24, pitch = 33, yaw = 0, minDistance = 13, maxDistance = 40, height = 0.9 } = {}) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.follow = null;
    this.offset = new THREE.Vector3(0, height, 0);
    this.lookAhead = new THREE.Vector3();
    this.distance = distance;
    this.distanceTarget = distance;
    this.pitch = pitch * DEG;
    this.pitchTarget = pitch * DEG;
    this.yaw = yaw * DEG;
    this.yawTarget = yaw * DEG;
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    this.bounds = null;
    this.followLambda = 4.5;
    this.shake = 0;
    this._script = null;
    this._desired = new THREE.Vector3();
  }

  snap() {
    if (this.follow) this.target.copy(this.follow.position).add(this.offset);
    this.distance = this.distanceTarget;
    this.pitch = this.pitchTarget;
    this.yaw = this.yawTarget;
    this._apply(0);
  }

  zoom(steps) {
    this.distanceTarget = THREE.MathUtils.clamp(this.distanceTarget * Math.pow(1.1, steps), this.minDistance, this.maxDistance);
  }

  orbit(deltaDeg) {
    this.yawTarget += deltaDeg * DEG;
  }

  /** Fly from an establishing shot into the gameplay framing. */
  intro({ duration = 4.5, distance = 58, pitch = 52, yaw = -28 } = {}) {
    this._script = {
      t: 0, duration,
      from: { distance, pitch: pitch * DEG, yaw: yaw * DEG },
      to: { distance: this.distanceTarget, pitch: this.pitchTarget, yaw: this.yawTarget },
    };
    this.distance = distance;
    this.pitch = pitch * DEG;
    this.yaw = yaw * DEG;
  }

  get scripted() {
    return !!this._script;
  }

  update(dt) {
    if (this.follow) {
      this._desired.copy(this.follow.position).add(this.offset).add(this.lookAhead);
      if (this.bounds) {
        this._desired.x = THREE.MathUtils.clamp(this._desired.x, this.bounds.minX, this.bounds.maxX);
        this._desired.z = THREE.MathUtils.clamp(this._desired.z, this.bounds.minZ, this.bounds.maxZ);
      }
      this.target.x = damp(this.target.x, this._desired.x, this.followLambda, dt);
      this.target.y = damp(this.target.y, this._desired.y, this.followLambda * 0.7, dt);
      this.target.z = damp(this.target.z, this._desired.z, this.followLambda, dt);
    }
    if (this._script) {
      const s = this._script;
      s.t = Math.min(1, s.t + dt / s.duration);
      const e = 1 - Math.pow(1 - s.t, 3);
      this.distance = THREE.MathUtils.lerp(s.from.distance, s.to.distance, e);
      this.pitch = THREE.MathUtils.lerp(s.from.pitch, s.to.pitch, e);
      this.yaw = THREE.MathUtils.lerp(s.from.yaw, s.to.yaw, e);
      if (s.t >= 1) this._script = null;
    } else {
      this.distance = damp(this.distance, this.distanceTarget, 6, dt);
      this.pitch = damp(this.pitch, this.pitchTarget, 6, dt);
      this.yaw = damp(this.yaw, this.yawTarget, 6, dt);
    }
    this._apply(dt);
  }

  _apply(dt) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const d = this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * d,
      this.target.y + sp * d,
      this.target.z + Math.cos(this.yaw) * cp * d,
    );
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2);
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.2;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.2;
    }
    this.camera.lookAt(this.target);
    globalUniforms.uCamYaw.value = this.yaw;
  }

  /** Distance from the camera to a world point (used for autofocus). */
  distanceTo(p) {
    return this.camera.position.distanceTo(p);
  }
}
