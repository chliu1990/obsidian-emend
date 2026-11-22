interface FakeWindow {
	innerWidth: number;
	innerHeight: number;
	requestAnimationFrame(callback: FrameRequestCallback): number;
	cancelAnimationFrame(handle: number): void;
	flushAnimationFrame(): void;
}

export class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	readonly ownerDocument: {
		body: FakeElement;
		defaultView: FakeWindow;
		createElement: () => FakeElement;
		addEventListener: () => undefined;
		removeEventListener: () => undefined;
		activeElement: FakeElement | null;
	};
	readonly style: Record<string, string> = {};
	className = '';
	textContent = '';
	title = '';
	disabled = false;
	value = '';
	checked = false;
	indeterminate = false;
	open = false;
	hidden = false;
	scrollTop = 0;
	scrollHeight = 0;
	clientHeight = 0;
	isConnected = true;
	removed = false;
	focused = false;
	selectionStart = 0;
	selectionEnd = 0;
	parentElement: FakeElement | null = null;
	scrollIntoViewCalls = 0;

	constructor(readonly tagName = 'div', ownerDocument?: FakeElement['ownerDocument']) {
		if (ownerDocument) {
			this.ownerDocument = ownerDocument;
		} else {
			let nextFrameHandle = 1;
			const frames = new Map<number, FrameRequestCallback>();
			const document = {
				body: null as unknown as FakeElement,
				defaultView: {
					innerWidth: 800,
					innerHeight: 600,
					requestAnimationFrame: (callback: FrameRequestCallback) => {
						const handle = nextFrameHandle++;
						frames.set(handle, callback);
						return handle;
					},
					cancelAnimationFrame: (handle: number) => {
						frames.delete(handle);
					},
					flushAnimationFrame: () => {
						const next = frames.entries().next().value;
						if (!next) {
							return;
						}
						const [handle, callback] = next;
						frames.delete(handle);
						callback(0);
					},
				},
				createElement: () => new FakeElement('div', this.ownerDocument),
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
				activeElement: null,
			};
			this.ownerDocument = document;
			document.body = new FakeElement('body', document);
		}
	}

	get lastElementChild(): FakeElement | null {
		return this.children.at(-1) ?? null;
	}

	createDiv(options?: string | { cls?: string; text?: string }) {
		return this.append('div', options);
	}

	createSpan(options?: string | { cls?: string; text?: string }) {
		return this.append('span', options);
	}

	createEl(
		tagName: string,
		options?: {
			cls?: string;
			text?: string;
			attr?: Record<string, string>;
		},
	) {
		return this.append(tagName, options);
	}

	addClass(className: string) {
		this.className = `${this.className} ${className}`.trim();
	}

	querySelector(selector?: string): FakeElement | null {
		if (!selector) {
			return this.children[0] ?? null;
		}
		const messageId = selector.match(/^\[data-message-id="([^"]+)"\]$/)?.[1];
		if (messageId !== undefined) {
			return findElements(
				this,
				(element) => element.attributes['data-message-id'] === messageId,
			)[0] ?? null;
		}
		return null;
	}

	getBoundingClientRect() {
		return { top: 0, bottom: 30, left: 0, right: 200, width: 200, height: 30 };
	}

	contains(candidate: FakeElement | null): boolean {
		return candidate === this || this.children.some((child) => child.contains(candidate));
	}

	scrollIntoView() {
		this.scrollIntoViewCalls += 1;
	}

	insertBefore(child: FakeElement, reference: FakeElement | null) {
		const existingIndex = this.children.indexOf(child);
		if (existingIndex >= 0) {
			this.children.splice(existingIndex, 1);
		}
		const referenceIndex = reference ? this.children.indexOf(reference) : -1;
		if (referenceIndex >= 0) {
			this.children.splice(referenceIndex, 0, child);
		} else {
			this.children.push(child);
		}
		return child;
	}

	setAttribute(name: string, value: string) {
		this.attributes[name] = value;
	}

	removeAttribute(name: string) {
		delete this.attributes[name];
	}

	setSelectionRange(start: number, end: number) {
		this.selectionStart = start;
		this.selectionEnd = end;
	}

	focus() {
		this.focused = true;
		this.ownerDocument.activeElement = this;
	}

	blur() {
		this.focused = false;
		if (this.ownerDocument.activeElement === this) {
			this.ownerDocument.activeElement = null;
		}
	}

	replaceWith(replacement: FakeElement) {
		this.replacement = replacement;
		const parent = this.parentElement;
		if (parent) {
			const index = parent.children.indexOf(this);
			if (index >= 0) {
				parent.children.splice(index, 1, replacement);
			}
		}
		replacement.parentElement = parent;
		this.parentElement = null;
		this.isConnected = false;
	}

	replacement?: FakeElement;

	private readonly listeners = new Map<string, Array<() => void>>();

	addEventListener(type: string, listener: () => void) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatch(type: string) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener();
		}
	}

	empty() {
		this.children.length = 0;
		this.textContent = '';
	}

	remove() {
		if (this.parentElement) {
			const index = this.parentElement.children.indexOf(this);
			if (index >= 0) {
				this.parentElement.children.splice(index, 1);
			}
		}
		this.parentElement = null;
		this.removed = true;
		this.isConnected = false;
	}

	private append(
		tagName: string,
		options?: string | {
			cls?: string;
			text?: string;
			attr?: Record<string, string>;
		},
	) {
		const child = new FakeElement(tagName, this.ownerDocument);
		child.parentElement = this;
		if (typeof options === 'string') {
			child.className = options;
		} else {
			child.className = options?.cls ?? '';
			child.textContent = options?.text ?? '';
			Object.assign(child.attributes, options?.attr);
			if (tagName === 'option') {
				child.value = options?.attr?.value ?? child.textContent;
			}
		}
		this.children.push(child);
		return child;
	}
}

export function flushAnimationFrame(root: FakeElement): void {
	root.ownerDocument.defaultView.flushAnimationFrame();
}

export function findElements(
	root: FakeElement,
	predicate: (element: FakeElement) => boolean,
): FakeElement[] {
	return [
		...(predicate(root) ? [root] : []),
		...root.children.flatMap((child) => findElements(child, predicate)),
	];
}

export function textOf(root: FakeElement): string {
	return [root.textContent, ...root.children.map(textOf)].join(' ');
}

export function messageContentElements(root: FakeElement): FakeElement[] {
	return findElements(
		root,
		(element) => element.className.split(' ')
			.some((name) => name === 'emend-chat-message-content'
				|| name === 'emend-chat-message-markdown'),
	);
}

export function markdownContentElements(root: FakeElement): FakeElement[] {
	return findElements(
		root,
		(element) => element.className.split(' ').includes('emend-chat-message-markdown'),
	);
}

export function webDraftLabelElements(root: FakeElement): FakeElement[] {
	return findElements(
		root,
		(element) => element.className.split(' ').includes('emend-chat-web-draft-label'),
	);
}

export function findMessageNode(root: FakeElement, messageId: string): FakeElement | undefined {
	return findElements(
		root,
		(element) => element.attributes['data-message-id'] === messageId,
	)[0];
}
