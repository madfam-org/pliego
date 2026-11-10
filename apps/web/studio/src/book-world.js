// @ts-check
// Bounded reader world: the active leaf uses the native solver, resting pages are fixed.
import { readingBook, readingPose, spreadPages } from './book-layout.js';

const SETTLE_SECONDS = 1.4;
export class BookWorld {
  constructor(engine, json, opts = {}, onPosition = () => {}) {
    this.book = readingBook(json);
    if (!this.book) throw new Error('Unsupported native reading book');
    this.engine = engine; this.json = json; this.opts = { ...opts, mechanismRate: 240, plasticity: false };
    this.onPosition = onPosition; this.position = 0; this.active = 0; this.readingBusy = false;
    this.models = new Map(); this.snapshots = new Map(); this.operation = null; this.destination = null; this.readingHeld = false; this.disposed = false;
    this.values = new Map(this.book.leaves.map(l => [l.control, 0]));
    this.world = this.model(0);
  }
  model(index) {
    if (!this.models.has(index)) {
      const json = readingPose(this.json, this.book, index);
      const world = new this.engine.World(this.engine.loadDocument(json), this.opts);
      if (this.snapshots.has(index)) world.restore(this.snapshots.get(index));
      this.models.set(index, world);
      if (this.models.size > 2) this.models.delete(this.models.keys().next().value);
    }
    return this.models.get(index);
  }
  select(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.book.leaves.length || this.readingBusy || this.disposed || (index !== this.position && index !== this.position - 1)) return false;
    const world = this.model(index), goal = index < this.position ? 180 : 0;
    if (Math.abs(world.getControl(this.book.leaves[index].control) - goal) > 1e-6) throw new Error('Reading leaf has not settled at its endpoint');
    this.active = index; this.world = world; this.readingHeld = true;
    world.setControl(this.book.leaves[index].control, goal); return true;
  }
  setControl(id, value) {
    const leaf = this.book.leaves[this.active];
    if (id !== leaf.control) return;
    if (!this.readingBusy && value !== this.values.get(id)) this.readingHeld = true;
    this.world.setControl(id, value); this.values.set(id, value);
  }
  getControl(id) { return this.values.get(id); }
  finish(value, position) {
    if (this.disposed || this.readingBusy || ![0, 180].includes(value) || position !== this.active + (value === 180 ? 1 : 0)) return false;
    this.setControl(this.book.leaves[this.active].control, value);
    this.operation = { position, elapsed: 0 }; this.readingHeld = false; this.readingBusy = true;
    this.onPosition(this.readingState());
    return true;
  }
  navigate(direction) {
    if (!['forward', 'backward'].includes(direction)) return false;
    const index = direction === 'forward' ? this.position : this.position - 1;
    if (index < 0 || index >= this.book.leaves.length || !this.select(index)) return false;
    this.finish(direction === 'forward' ? 180 : 0, this.position + (direction === 'forward' ? 1 : -1)); return true;
  }
  goTo(position) {
    if (this.readingBusy || !Number.isInteger(position) || position < 0 || position > this.book.leaves.length) return false;
    if (position === this.position) return true;
    this.destination = position; return this.navigate(position > this.position ? 'forward' : 'backward');
  }
  step(dt = 1 / 60) {
    if (this.disposed) return;
    if (!(Number.isFinite(dt) && dt > 0)) throw new RangeError('Reading step must advance positive finite time');
    if (!this.readingBusy && !this.readingHeld) return;
    const before = this.world.time;
    this.world.step(dt);
    if (!this.world.stats().finite) throw new Error('Reading paper became non-finite');
    if (this.operation) this.operation.elapsed += this.world.time - before;
    if (this.operation && this.operation.elapsed + 1e-9 >= SETTLE_SECONDS) {
      this.position = this.operation.position; this.operation = null; this.readingBusy = false;
      this.promoteRestingLeaf();
      for (let i = 0; i < this.book.leaves.length; i++) this.values.set(this.book.leaves[i].control, i < this.position ? 180 : 0);
      if (this.destination !== null && this.position !== this.destination) this.navigate(this.destination > this.position ? 'forward' : 'backward');
      else { this.destination = null; this.onPosition(this.readingState()); }
    }
  }
  // Explicit model reduction: the released leaf joins a flat resting page block.
  // This is a reader endpoint, not an equilibrium/contact validation result.
  promoteRestingLeaf() {
    const w = this.world, s = w.snapshot(), sheet = this.book.leaves[this.active].sheet;
    this.lastRelease = { positions: s.x.slice(), stats: w.stats(), sheet };
    const left = this.active < this.position, spineX = this.book.origin[0];
    for (let v = 0; v < w.mesh.nV; v++) if (w.mesh.vSheet[v] === sheet) {
      s.x[3 * v] = left ? 2 * spineX - w.X0[3 * v] : w.X0[3 * v];
      s.x[3 * v + 1] = w.X0[3 * v + 1]; s.x[3 * v + 2] = w.X0[3 * v + 2];
    }
    s.v.fill(0); s.theta.fill(0); s.dirty = true; s.asleep = true;
    s.contactSide = []; s.factor = null;
    w.restore(s); this.snapshots.set(this.active, w.snapshot());
  }
  readingState() { return { position: this.position, pages: spreadPages(this.position, this.book.leaves.length), total: this.book.pages, busy: this.readingBusy }; }
  render() { return this.world.render(); }
  stats() {
    const s = this.world.stats();
    return this.readingBusy || this.readingHeld ? s : { ...s, asleep: true, contacts: 0, edgeContacts: 0, grounded: 0 };
  }
  pick(origin, direction) { return this.world.pick(origin, direction); }
  release() { this.world.release(); }
  creaseLines() { return this.world.creaseLines(); }
  dispose() { this.disposed = true; this.release(); this.models.clear(); this.snapshots.clear(); }
}
