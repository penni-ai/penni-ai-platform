type FirestoreDocData = Record<string, any>;

function clone<T>(value: T): T {
	const deepClone = (input: any, seen = new WeakMap<object, any>()): any => {
		if (typeof input === 'function') return input;
		if (input == null || typeof input !== 'object') return input;

		if (input instanceof Date) {
			return new Date(input.getTime());
		}

		if (Array.isArray(input)) {
			return input.map((item) => deepClone(item, seen));
		}

		const proto = Object.getPrototypeOf(input);
		if (proto && proto !== Object.prototype) {
			// Treat non-plain objects (e.g. Firestore FieldValue) as atomic.
			return input;
		}

		if (seen.has(input)) return seen.get(input);

		const out: any = proto === null ? Object.create(null) : {};
		seen.set(input, out);

		for (const [key, val] of Object.entries(input)) {
			out[key] = deepClone(val, seen);
		}
		return out;
	};

	try {
		// Node 18+
		// eslint-disable-next-line no-undef
		return structuredClone(value);
	} catch {
		// Fallback: preserve function-valued fields (e.g. Firestore Timestamp mocks).
		try {
			return deepClone(value);
		} catch {
			// Best-effort for non-serializable sentinels (e.g. Firestore FieldValue).
			return value;
		}
	}
}

function getByPath(obj: any, path: string): any {
	const parts = path.split('.');
	let cursor: any = obj;
	for (const part of parts) {
		if (cursor == null) return undefined;
		cursor = cursor[part];
	}
	return cursor;
}

function setByPath(obj: any, path: string, value: any): void {
	const parts = path.split('.');
	let cursor: any = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i];
		if (cursor[key] == null || typeof cursor[key] !== 'object') {
			cursor[key] = {};
		}
		cursor = cursor[key];
	}
	cursor[parts[parts.length - 1]] = value;
}

function deleteByPath(obj: any, path: string): void {
	const parts = path.split('.');
	let cursor: any = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i];
		if (cursor == null || typeof cursor !== 'object') return;
		cursor = cursor[key];
	}
	if (cursor == null || typeof cursor !== 'object') return;
	delete cursor[parts[parts.length - 1]];
}

const DELETE_SENTINEL = Symbol('FAKE_FIRESTORE_DELETE');

function mergeValue(current: any, patch: any): any {
	const kind = patch && typeof patch === 'object' ? (patch as any)?.constructor?.name : undefined;
	if (kind === 'DeleteTransform') return DELETE_SENTINEL;
	if (kind === 'NumericIncrementTransform') {
		const operand = typeof (patch as any).operand === 'number' ? (patch as any).operand : 0;
		const base = typeof current === 'number' ? current : 0;
		return base + operand;
	}
	if (kind === 'ServerTimestampTransform') {
		return Date.now();
	}

	if (patch == null || typeof patch !== 'object') return patch;

	const patchProto = Object.getPrototypeOf(patch);
	if (patchProto && patchProto !== Object.prototype) {
		// Treat non-plain objects (e.g. Date) as atomic.
		return patch;
	}
	if (Array.isArray(patch)) return clone(patch);

	const out: any =
		current && typeof current === 'object' && !Array.isArray(current) ? clone(current) : {};
	for (const [key, value] of Object.entries(patch)) {
		const merged = mergeValue(out[key], value);
		if (merged === DELETE_SENTINEL) {
			delete out[key];
		} else {
			out[key] = merged;
		}
	}
	return out;
}

function normalizePath(path: string): string {
	return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

function pathSegments(path: string): string[] {
	const normalized = normalizePath(path);
	return normalized ? normalized.split('/') : [];
}

class FakeDocumentSnapshot {
	constructor(
		public readonly id: string,
		public readonly ref: FakeDocumentReference,
		private readonly _exists: boolean,
		private readonly _data: FirestoreDocData | undefined
	) {}

	get exists() {
		return this._exists;
	}

	get(fieldPath: string) {
		if (!this._data) return undefined;
		return getByPath(this._data, fieldPath);
	}

	data() {
		return this._data ? clone(this._data) : undefined;
	}
}

class FakeQueryDocumentSnapshot extends FakeDocumentSnapshot {
	constructor(id: string, ref: FakeDocumentReference, data: FirestoreDocData) {
		super(id, ref, true, data);
	}
}

class FakeQuerySnapshot {
	constructor(public readonly docs: FakeQueryDocumentSnapshot[]) {}

	get empty() {
		return this.docs.length === 0;
	}

	get size() {
		return this.docs.length;
	}

	forEach(fn: (doc: FakeQueryDocumentSnapshot) => void) {
		this.docs.forEach(fn);
	}
}

type WhereOp = '==' | '<=' | '<' | '>=' | '>' | 'in';
type OrderDirection = 'asc' | 'desc';

class FakeQuery {
	private readonly filters: Array<{ field: string; op: WhereOp; value: any }> = [];
	private readonly orderBys: Array<{ field: string; direction: OrderDirection }> = [];
	private limitCount: number | null = null;

	constructor(
		private readonly db: FakeFirestore,
		private readonly kind: { type: 'collection'; path: string } | { type: 'collectionGroup'; id: string }
	) {}

	where(field: string, op: WhereOp, value: any) {
		this.filters.push({ field, op, value });
		return this;
	}

	orderBy(field: string, direction: OrderDirection = 'asc') {
		this.orderBys.push({ field, direction });
		return this;
	}

	limit(n: number) {
		this.limitCount = n;
		return this;
	}

	count() {
		const query = this;
		return {
			async get() {
				const snap = await query.get();
				return {
					data: () => ({ count: snap.size })
				};
			}
		};
	}

	async get() {
		const candidates =
			this.kind.type === 'collection'
				? this.db._listDocsInCollectionPath(this.kind.path)
				: this.db._listDocsInCollectionGroup(this.kind.id);

		let rows = candidates.map(({ path, id, data }) => ({ path, id, data }));

		for (const f of this.filters) {
			rows = rows.filter(({ data }) => {
				const actual = getByPath(data, f.field);
				switch (f.op) {
					case '==':
						return actual === f.value;
					case '<=':
						return actual <= f.value;
					case '<':
						return actual < f.value;
					case '>=':
						return actual >= f.value;
					case '>':
						return actual > f.value;
					case 'in':
						return Array.isArray(f.value) ? f.value.includes(actual) : false;
					default:
						return false;
				}
			});
		}

		for (const ob of this.orderBys.reverse()) {
			rows.sort((a, b) => {
				const av = getByPath(a.data, ob.field);
				const bv = getByPath(b.data, ob.field);
				if (av === bv) return 0;
				if (ob.direction === 'desc') return av > bv ? -1 : 1;
				return av > bv ? 1 : -1;
			});
		}

		if (typeof this.limitCount === 'number') {
			rows = rows.slice(0, this.limitCount);
		}

		const docs = rows.map(({ path, id, data }) => new FakeQueryDocumentSnapshot(id, this.db._doc(path), data));
		return new FakeQuerySnapshot(docs);
	}
}

class FakeWriteBatch {
	private readonly ops: Array<() => void> = [];

	constructor(private readonly db: FakeFirestore) {}

	set(docRef: FakeDocumentReference, data: FirestoreDocData, options?: { merge?: boolean }) {
		this.ops.push(() => this.db._set(docRef.path, data, { merge: options?.merge === true }));
		return this;
	}

	delete(docRef: FakeDocumentReference) {
		this.ops.push(() => this.db._delete(docRef.path));
		return this;
	}

	async commit() {
		for (const op of this.ops) op();
	}
}

class FakeTransaction {
	constructor(private readonly db: FakeFirestore) {}

	async get(refOrQuery: any) {
		if (refOrQuery instanceof FakeDocumentReference) {
			return this.db._get(refOrQuery.path);
		}
		if (refOrQuery && typeof refOrQuery.get === 'function') {
			return refOrQuery.get();
		}
		throw new Error('Unsupported transaction get() argument');
	}

	update(docRef: FakeDocumentReference, updates: Record<string, any>) {
		this.db._update(docRef.path, updates);
	}

	set(docRef: FakeDocumentReference, data: FirestoreDocData, options?: { merge?: boolean }) {
		this.db._set(docRef.path, data, { merge: options?.merge === true });
	}
}

export class FakeDocumentReference {
	constructor(
		private readonly db: FakeFirestore,
		public readonly path: string
	) {}

	get id() {
		const segs = pathSegments(this.path);
		return segs[segs.length - 1] || '';
	}

	collection(collectionId: string) {
		return this.db.collection(`${normalizePath(this.path)}/${collectionId}`);
	}

	async get() {
		return this.db._get(this.path);
	}

	async set(data: FirestoreDocData, options?: { merge?: boolean }) {
		this.db._set(this.path, data, { merge: options?.merge === true });
	}

	async update(updates: Record<string, any>) {
		this.db._update(this.path, updates);
	}

	async delete() {
		this.db._delete(this.path);
	}
}

export class FakeCollectionReference {
	constructor(
		private readonly db: FakeFirestore,
		public readonly path: string
	) {}

	doc(docId: string) {
		return this.db._doc(`${normalizePath(this.path)}/${docId}`);
	}

	where(field: string, op: WhereOp, value: any) {
		return new FakeQuery(this.db, { type: 'collection', path: this.path }).where(field, op, value);
	}

	orderBy(field: string, direction: OrderDirection = 'asc') {
		return new FakeQuery(this.db, { type: 'collection', path: this.path }).orderBy(field, direction);
	}

	limit(n: number) {
		return new FakeQuery(this.db, { type: 'collection', path: this.path }).limit(n);
	}

	async get() {
		return new FakeQuery(this.db, { type: 'collection', path: this.path }).get();
	}
}

export class FakeFirestore {
	private readonly docs = new Map<string, FirestoreDocData>();

	constructor(initial?: Record<string, FirestoreDocData>) {
		if (initial) {
			for (const [path, data] of Object.entries(initial)) {
				this.docs.set(normalizePath(path), clone(data));
			}
		}
	}

	collection(collectionPath: string) {
		return new FakeCollectionReference(this, normalizePath(collectionPath));
	}

	collectionGroup(collectionId: string) {
		return new FakeQuery(this, { type: 'collectionGroup', id: collectionId });
	}

	batch() {
		return new FakeWriteBatch(this);
	}

	async getAll(...docRefs: FakeDocumentReference[]) {
		return Promise.all(docRefs.map((ref) => this._get(ref.path)));
	}

	async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>) {
		const tx = new FakeTransaction(this);
		return fn(tx);
	}

	_doc(path: string) {
		return new FakeDocumentReference(this, normalizePath(path));
	}

	_get(path: string) {
		const normalized = normalizePath(path);
		const data = this.docs.get(normalized);
		const ref = this._doc(normalized);
		return new FakeDocumentSnapshot(ref.id, ref, Boolean(data), data);
	}

	_set(path: string, data: FirestoreDocData, options: { merge: boolean }) {
		const normalized = normalizePath(path);
		if (!options.merge) {
			this.docs.set(normalized, clone(mergeValue({}, data)));
			return;
		}
		const current = this.docs.get(normalized) ?? {};
		this.docs.set(normalized, clone(mergeValue(current, data)));
	}

	_update(path: string, updates: Record<string, any>) {
		const normalized = normalizePath(path);
		const current = this.docs.get(normalized);
		if (!current) {
			throw new Error(`No document to update at ${normalized}`);
		}
		const next = clone(current);
		for (const [key, value] of Object.entries(updates)) {
			const currentValue = key.includes('.') ? getByPath(next, key) : (next as any)[key];
			const merged = mergeValue(currentValue, value);
			if (key.includes('.')) {
				if (merged === DELETE_SENTINEL) {
					deleteByPath(next, key);
				} else {
					setByPath(next, key, merged);
				}
			} else {
				if (merged === DELETE_SENTINEL) {
					delete (next as any)[key];
				} else {
					(next as any)[key] = merged;
				}
			}
		}
		this.docs.set(normalized, next);
	}

	_delete(path: string) {
		this.docs.delete(normalizePath(path));
	}

	_listDocsInCollectionPath(collectionPath: string) {
		const base = normalizePath(collectionPath);
		const baseSegs = pathSegments(base);
		const out: Array<{ path: string; id: string; data: FirestoreDocData }> = [];
		for (const [path, data] of this.docs.entries()) {
			const segs = pathSegments(path);
			if (segs.length !== baseSegs.length + 1) continue;
			if (segs.slice(0, baseSegs.length).join('/') !== base) continue;
			out.push({ path, id: segs[segs.length - 1], data: clone(data) });
		}
		return out;
	}

	_listDocsInCollectionGroup(collectionId: string) {
		const out: Array<{ path: string; id: string; data: FirestoreDocData }> = [];
		for (const [path, data] of this.docs.entries()) {
			const segs = pathSegments(path);
			if (segs.length < 2) continue;
			const parentCollection = segs[segs.length - 2];
			if (parentCollection !== collectionId) continue;
			out.push({ path, id: segs[segs.length - 1], data: clone(data) });
		}
		return out;
	}

	_dump() {
		return new Map(this.docs);
	}
}

export class FakeStorageFile {
	constructor(
		private readonly store: Map<string, Buffer>,
		public readonly name: string
	) {}

	async save(buffer: Buffer, _options?: any) {
		this.store.set(this.name, Buffer.from(buffer));
	}

	async exists(): Promise<[boolean]> {
		return [this.store.has(this.name)];
	}

	async download(): Promise<[Buffer]> {
		const buf = this.store.get(this.name);
		if (!buf) {
			throw new Error(`No such file: ${this.name}`);
		}
		return [Buffer.from(buf)];
	}
}

export class FakeStorageBucket {
	public readonly name: string;
	private readonly store: Map<string, Buffer>;

	constructor(name: string, store: Map<string, Buffer>) {
		this.name = name;
		this.store = store;
	}

	file(path: string) {
		return new FakeStorageFile(this.store, normalizePath(path));
	}
}

export class FakeStorage {
	private readonly store = new Map<string, Buffer>();
	constructor(private readonly bucketName = 'test-bucket') {}

	bucket(name?: string) {
		return new FakeStorageBucket(name ?? this.bucketName, this.store);
	}

	_dump() {
		return new Map(this.store);
	}
}
