import { Menu, MenuItem } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ChatModelControl,
	type ChatModelControlCallbacks,
	type ChatModelControlState,
} from '../src/chat-model-control';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { EmendSettings, ProviderId } from '../src/types';

type TestMenuItem = MenuItem & {
	title: string;
	checked: boolean | null;
	disabled: boolean;
	clickHandler: (event: MouseEvent | KeyboardEvent) => unknown;
};

type TestMenu = Menu & {
	items: Array<TestMenuItem | 'separator'>;
	position: { x: number; y: number } | null;
	shownDocument: Document | undefined;
	hideCalls: number;
};

const TestMenu = Menu as unknown as { instances: TestMenu[] };

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	readonly listeners = new Map<string, Array<() => void>>();
	className = '';
	textContent = '';
	title = '';
	disabled = false;
	removed = false;

	constructor(
		readonly tagName = 'div',
		readonly ownerDocument: Document = {} as Document,
	) {}

	createEl(
		tagName: string,
		options?: string | { cls?: string; text?: string; attr?: Record<string, string> },
	) {
		const child = new FakeElement(tagName, this.ownerDocument);
		if (typeof options === 'string') {
			child.className = options;
		} else {
			child.className = options?.cls ?? '';
			child.textContent = options?.text ?? '';
			Object.assign(child.attributes, options?.attr);
		}
		this.children.push(child);
		return child;
	}

	setAttribute(name: string, value: string) {
		this.attributes[name] = value;
	}

	addEventListener(type: string, listener: () => void) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	click() {
		if (this.disabled) {
			return;
		}
		for (const listener of this.listeners.get('click') ?? []) {
			listener();
		}
	}

	getBoundingClientRect() {
		return {
			x: 12,
			y: 34,
			left: 12,
			top: 34,
			right: 112,
			bottom: 64,
			width: 100,
			height: 30,
			toJSON: () => ({}),
		} as DOMRect;
	}

	remove() {
		this.removed = true;
	}
}

function createSettings(): EmendSettings {
	const settings = structuredClone(DEFAULT_SETTINGS);
	settings.providers.deepseek.discoveredModels = [
		{ id: 'model-a', displayName: 'Model A' },
	];
	settings.providers.kimi.discoveredModels = [
		{ id: 'kimi-cached', displayName: 'Kimi Cached' },
	];
	settings.providers.custom.discoveredModels = [
		{ id: 'custom-discovered', displayName: 'Discovered Custom' },
	];
	settings.providers.custom.model = 'configured-only';
	return settings;
}

function createState(
	settings = createSettings(),
	disabled = false,
	availableProviderIds: readonly ProviderId[] = ['deepseek', 'kimi', 'custom'],
): ChatModelControlState {
	return { settings, disabled, availableProviderIds };
}

function modelCallbacks() {
	return {
		onSelect: vi.fn(async () => {}),
	} satisfies ChatModelControlCallbacks;
}

function renderControl(
	settings = createSettings(),
	disabled = false,
	availableProviderIds?: readonly ProviderId[],
) {
	const ownerDocument = { name: 'popout-document' } as unknown as Document;
	const container = new FakeElement('div', ownerDocument);
	const writing = container.createEl('button', { text: 'Chat' });
	const callbacks = modelCallbacks();
	const control = new ChatModelControl(callbacks);
	control.render(
		container as unknown as HTMLElement,
		createState(settings, disabled, availableProviderIds),
	);
	const send = container.createEl('button', { text: 'Send' });
	const trigger = container.children[1];
	if (!trigger) {
		throw new Error('The model control did not render its trigger.');
	}
	return {
		container,
		writing,
		trigger,
		send,
		callbacks,
		control,
		ownerDocument,
		settings,
	};
}

function openMenu(trigger: FakeElement): TestMenu {
	trigger.click();
	const menu = TestMenu.instances.at(-1);
	if (!menu) {
		throw new Error('The model trigger did not open a menu.');
	}
	return menu;
}

function menuItems(menu: TestMenu): TestMenuItem[] {
	return menu.items.filter((item): item is TestMenuItem => item instanceof MenuItem);
}

function providerItems(menu: TestMenu, provider: string): TestMenuItem[] {
	const start = menu.items.findIndex(
		(item) => item !== 'separator' && item.title === provider,
	);
	if (start < 0) {
		throw new Error(`Missing provider group: ${provider}`);
	}
	const items: TestMenuItem[] = [];
	for (const item of menu.items.slice(start)) {
		if (item === 'separator') {
			break;
		}
		items.push(item);
	}
	return items;
}

function menuItem(menu: TestMenu, provider: string, title: string): TestMenuItem {
	const item = providerItems(menu, provider).find((candidate) => candidate.title === title);
	if (!item) {
		throw new Error(`Missing ${provider} menu item: ${title}`);
	}
	return item;
}

function reasoningItems(menu: TestMenu): TestMenuItem[] {
	const start = menu.items.findIndex(
		(item) => item !== 'separator' && item.title === 'Reasoning effort',
	);
	if (start < 0) {
		throw new Error('Missing reasoning effort section.');
	}
	return menu.items.slice(start + 1).filter(
		(item): item is TestMenuItem => item instanceof MenuItem,
	);
}

function effortItem(menu: TestMenu, title: string): TestMenuItem {
	const item = reasoningItems(menu).find((candidate) => candidate.title === title);
	if (!item) {
		throw new Error(`Missing reasoning effort item: ${title}`);
	}
	return item;
}

function choose(item: TestMenuItem) {
	item.clickHandler({} as MouseEvent);
}

beforeEach(() => {
	TestMenu.instances.length = 0;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('ChatModelControl', () => {
	it('renders one accessible trigger between the writing and send buttons', () => {
		const { container, writing, trigger, send, control } = renderControl();

		expect(trigger.tagName).toBe('button');
		expect(trigger.className).toBe('emend-chat-active-model');
		expect(trigger.textContent).toBe('DeepSeek · deepseek-flash · High');
		expect(trigger.title).toBe('DeepSeek · deepseek-flash · High');
		expect(trigger.attributes.type).toBe('button');
		expect(trigger.attributes['aria-label']).toBe(
			'Provider, model, and reasoning: DeepSeek · deepseek-flash · High',
		);
		expect(trigger.attributes['aria-haspopup']).toBe('menu');
		expect(trigger.attributes['aria-expanded']).toBe('false');
		expect(container.children).toEqual([writing, trigger, send]);

		control.render(container as unknown as HTMLElement, createState());
		expect(container.children).toEqual([writing, trigger, send]);
	});

	it('builds exactly one model section and one active-provider reasoning section', () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const { trigger } = renderControl();

		const menu = openMenu(trigger);

		expect(trigger.attributes['aria-expanded']).toBe('true');
		expect(menu.items.map((item) => item === 'separator'
			? 'separator'
			: [item.title, item.checked, item.disabled])).toEqual([
			['Model', null, true],
			['DeepSeek', null, true],
			['deepseek-flash', true, false],
			['deepseek-v4-pro', false, false],
			['Model A', false, false],
			['Kimi', null, true],
			['k3.1-pro', false, false],
			['Kimi Cached', false, false],
			['Custom', null, true],
			['Discovered Custom', false, false],
			['configured-only', false, false],
			'separator',
			['Reasoning effort', null, true],
			['Low reasoning', false, false],
			['Medium reasoning', false, false],
			['High reasoning', true, false],
		]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('omits unavailable providers and available Custom without model options', () => {
		const withoutKimiKey = renderControl(createSettings(), false, ['deepseek', 'custom']);
		const keyFilteredMenu = openMenu(withoutKimiKey.trigger);

		expect(menuItems(keyFilteredMenu).some((item) => item.title === 'Kimi')).toBe(false);
		expect(menuItem(keyFilteredMenu, 'DeepSeek', 'deepseek-flash').disabled).toBe(false);
		expect(menuItem(keyFilteredMenu, 'Custom', 'configured-only').disabled).toBe(false);
		withoutKimiKey.control.destroy();

		const withoutCustomOptions = structuredClone(DEFAULT_SETTINGS);
		const emptyCustom = renderControl(withoutCustomOptions);
		const optionsFilteredMenu = openMenu(emptyCustom.trigger);

		expect(menuItems(optionsFilteredMenu).some((item) => item.title === 'Custom')).toBe(false);
		expect(menuItems(optionsFilteredMenu).some((item) => item.title === 'No model configured')).toBe(false);
		expect(menuItem(optionsFilteredMenu, 'Kimi', 'k3.1-pro').disabled).toBe(false);
	});

	it('shows only the no-available-models state when no provider qualifies', () => {
		const { trigger } = renderControl(createSettings(), false, []);

		const menu = openMenu(trigger);

		expect(menu.items.map((item) => item === 'separator'
			? 'separator'
			: [item.title, item.disabled])).toEqual([
			['Model', true],
			['No available models', true],
			'separator',
			['Reasoning effort', true],
			['Low reasoning', false],
			['Medium reasoning', false],
			['High reasoning', false],
		]);
	});

	it('selects a model with that provider’s stored effort and hides first', async () => {
		const { trigger, callbacks, settings } = renderControl();
		const menu = openMenu(trigger);
		callbacks.onSelect.mockImplementationOnce(async () => {
			expect(menu.hideCalls).toBe(1);
			expect(trigger.attributes['aria-expanded']).toBe('false');
		});

		choose(menuItem(menu, 'DeepSeek', 'deepseek-v4-pro'));
		await Promise.resolve();

		expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith(
			{ providerId: 'deepseek', modelId: 'deepseek-v4-pro' },
			'high',
		);
		expect(menu.hideCalls).toBe(1);
		expect(trigger.attributes['aria-expanded']).toBe('false');
		expect(settings.activeProvider).toBe('deepseek');
		expect(settings.providers.deepseek.model).toBe('deepseek-flash');
		expect(settings.providers.deepseek.reasoningEffort).toBe('high');
	});

	it('selects Medium reasoning only for the active provider and its trimmed current model', async () => {
		const settings = createSettings();
		settings.activeProvider = 'kimi';
		const { trigger, callbacks } = renderControl(settings);
		const menu = openMenu(trigger);
		callbacks.onSelect.mockImplementationOnce(async () => {
			expect(menu.hideCalls).toBe(1);
			expect(trigger.attributes['aria-expanded']).toBe('false');
		});

		choose(effortItem(menu, 'Medium reasoning'));
		await Promise.resolve();

		expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith(
			{ providerId: 'kimi', modelId: null },
			'medium',
		);
		expect(menu.hideCalls).toBe(1);
		expect(trigger.attributes['aria-expanded']).toBe('false');
		expect(settings.activeProvider).toBe('kimi');
		expect(settings.providers.kimi.model).toBe('k3.1-pro');
		expect(settings.providers.kimi.reasoningEffort).toBe('high');
	});

	it('disables the closed trigger and every open item while pending without rebuilding', () => {
		const { trigger, callbacks, control, settings } = renderControl();
		const menu = openMenu(trigger);
		const originalItems = menuItems(menu);

		control.update(createState(settings, true));

		expect(trigger.disabled).toBe(true);
		expect(menuItems(menu)).toEqual(originalItems);
		expect(menuItems(menu).every((item) => item.disabled)).toBe(true);
		choose(menuItem(menu, 'DeepSeek', 'deepseek-v4-pro'));
		choose(effortItem(menu, 'Medium reasoning'));
		expect(callbacks.onSelect).not.toHaveBeenCalled();
		expect(menu.hideCalls).toBe(0);

		control.update(createState(settings, false));
		expect(trigger.disabled).toBe(false);
		expect(menuItems(menu)).toEqual(originalItems);
		expect(menuItem(menu, 'DeepSeek', 'deepseek-v4-pro').disabled).toBe(false);
		expect(menuItem(menu, 'DeepSeek', 'DeepSeek').disabled).toBe(true);
	});

	it('rejects a disabled trigger click', () => {
		const { trigger } = renderControl(createSettings(), true);

		trigger.click();

		expect(trigger.disabled).toBe(true);
		expect(TestMenu.instances).toHaveLength(0);
	});

	it('shows Custom · High, omits its empty model group, and disables blank-current efforts', () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.activeProvider = 'custom';
		const { trigger, callbacks } = renderControl(settings);

		expect(trigger.textContent).toBe('Custom · High');
		expect(trigger.title).toBe('Custom · High');
		expect(trigger.attributes['aria-label']).toBe(
			'Provider, model, and reasoning: Custom · High',
		);
		const menu = openMenu(trigger);
		expect(menuItems(menu).some((item) => item.title === 'Custom')).toBe(false);
		expect(reasoningItems(menu).map((item) => [
			item.title,
			item.checked,
			item.disabled,
		])).toEqual([
			['Low reasoning', false, true],
			['Medium reasoning', false, true],
			['High reasoning', true, true],
		]);

		for (const item of reasoningItems(menu)) {
			choose(item);
		}
		expect(callbacks.onSelect).not.toHaveBeenCalled();
		expect(menu.hideCalls).toBe(0);
	});

	it.each(['deepseek', 'kimi', 'custom'] as const)(
		'disables %s reasoning with a blank current model while retaining model choices',
		(providerId) => {
			const settings = createSettings();
			settings.activeProvider = providerId;
			settings.providers[providerId].model = '   ';
			const { trigger, callbacks, control } = renderControl(settings);
			const menu = openMenu(trigger);
			const providerName = providerId === 'deepseek'
				? 'DeepSeek'
				: providerId === 'kimi' ? 'Kimi' : 'Custom';

			for (const effort of ['Low reasoning', 'Medium reasoning', 'High reasoning']) {
				const item = effortItem(menu, effort);
				expect(item.disabled).toBe(true);
				choose(item);
			}
			expect(callbacks.onSelect).not.toHaveBeenCalled();
			expect(menu.hideCalls).toBe(0);
			const modelId = providerId === 'deepseek'
				? 'deepseek-v4-pro'
				: providerId === 'kimi' ? 'k3.1-pro' : 'Discovered Custom';
			expect(menuItem(menu, providerName, modelId).disabled).toBe(false);

			const validSettings = createSettings();
			validSettings.activeProvider = providerId;
			control.update(createState(validSettings));
			expect(effortItem(menu, 'Low reasoning').disabled).toBe(false);
			validSettings.providers[providerId].model = '';
			control.update(createState(validSettings));
			const disabledEffort = effortItem(menu, 'Low reasoning');
			expect(disabledEffort.disabled).toBe(true);
			choose(disabledEffort);
			expect(callbacks.onSelect).not.toHaveBeenCalled();
		},
	);

	it('refreshes the summary and options, closes the old menu, and rejects stale items', () => {
		const { trigger, callbacks, control } = renderControl();
		const staleMenu = openMenu(trigger);
		const staleItem = menuItem(staleMenu, 'DeepSeek', 'deepseek-v4-pro');
		const settings = createSettings();
		settings.activeProvider = 'custom';
		settings.providers.custom.model = 'new-current';
		settings.providers.custom.discoveredModels = [
			{ id: 'new-discovery', displayName: 'New Discovery' },
		];

		control.refresh(settings, ['deepseek', 'kimi', 'custom']);

		expect(trigger.textContent).toBe('Custom · new-current · High');
		expect(trigger.title).toBe('Custom · new-current · High');
		expect(staleMenu.hideCalls).toBe(1);
		expect(trigger.attributes['aria-expanded']).toBe('false');
		choose(staleItem);
		expect(callbacks.onSelect).not.toHaveBeenCalled();

		const currentMenu = openMenu(trigger);
		expect(providerItems(currentMenu, 'Custom').map((item) => [
			item.title,
			item.checked,
		])).toEqual([
			['Custom', null],
			['New Discovery', false],
			['new-current', true],
		]);
		expect(reasoningItems(currentMenu).map((item) => [item.title, item.checked])).toEqual([
			['Low reasoning', false],
			['Medium reasoning', false],
			['High reasoning', true],
		]);
		expect(menuItems(currentMenu).some((item) => item.title === 'Discovered Custom')).toBe(false);
	});

	it('disables newly unavailable open-model items and rejects their direct callbacks', () => {
		const { trigger, callbacks, control, settings } = renderControl();
		const menu = openMenu(trigger);
		const kimiModel = menuItem(menu, 'Kimi', 'k3.1-pro');
		const discoveredModel = menuItem(menu, 'DeepSeek', 'Model A');

		control.update(createState(settings, false, ['deepseek', 'custom']));

		expect(kimiModel.disabled).toBe(true);
		choose(kimiModel);
		expect(callbacks.onSelect).not.toHaveBeenCalled();
		expect(menu.hideCalls).toBe(0);

		const withoutDiscovery = createSettings();
		withoutDiscovery.providers.deepseek.discoveredModels = [];
		control.update(createState(withoutDiscovery, false, ['deepseek', 'custom']));
		expect(discoveredModel.disabled).toBe(true);
		choose(discoveredModel);
		expect(callbacks.onSelect).not.toHaveBeenCalled();

		control.refresh(withoutDiscovery, ['deepseek']);
		expect(menu.hideCalls).toBe(1);
		choose(kimiModel);
		choose(discoveredModel);
		expect(callbacks.onSelect).not.toHaveBeenCalled();
	});

	it('keeps only the newest menu active and ignores stale hide and item callbacks', () => {
		const { trigger, callbacks } = renderControl();
		const staleMenu = openMenu(trigger);
		const staleItem = menuItem(staleMenu, 'DeepSeek', 'deepseek-v4-pro');
		const currentMenu = openMenu(trigger);

		expect(staleMenu.hideCalls).toBe(1);
		expect(trigger.attributes['aria-expanded']).toBe('true');
		choose(staleItem);
		staleMenu.hide();
		expect(callbacks.onSelect).not.toHaveBeenCalled();
		expect(trigger.attributes['aria-expanded']).toBe('true');

		choose(menuItem(currentMenu, 'DeepSeek', 'deepseek-v4-pro'));
		expect(callbacks.onSelect).toHaveBeenCalledOnce();
		expect(currentMenu.hideCalls).toBe(1);
		expect(trigger.attributes['aria-expanded']).toBe('false');
	});

	it('positions the menu from the trigger rectangle in its owner document', () => {
		const { trigger, ownerDocument } = renderControl();

		const menu = openMenu(trigger);

		expect(menu.position).toEqual({ x: 12, y: 64 });
		expect(menu.shownDocument).toBe(ownerDocument);
	});

	it('destroys idempotently and rejects stale selection and trigger callbacks', () => {
		const { container, writing, trigger, send, callbacks, control } = renderControl();
		const menu = openMenu(trigger);
		const item = menuItem(menu, 'DeepSeek', 'deepseek-v4-pro');

		control.destroy();
		control.destroy();

		expect(menu.hideCalls).toBe(1);
		expect(trigger.removed).toBe(true);
		expect(trigger.attributes['aria-expanded']).toBe('false');
		expect(container.children).toEqual([writing, trigger, send]);
		choose(item);
		trigger.click();
		control.update(createState());
		control.refresh(createSettings(), ['deepseek', 'kimi', 'custom']);
		control.render(container as unknown as HTMLElement, createState());
		expect(callbacks.onSelect).not.toHaveBeenCalled();
		expect(TestMenu.instances).toHaveLength(1);
	});

	it('keeps a long configured Custom ID complete in the summary and menu DOM data', () => {
		const longModel = 'custom-provider/model-with-a-very-long-identifier-that-must-remain-completely-inspectable-1234567890';
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.activeProvider = 'custom';
		settings.providers.custom.model = longModel;
		const { trigger } = renderControl(settings);
		const summary = `Custom · ${longModel} · High`;

		expect(trigger.textContent).toBe(summary);
		expect(trigger.title).toBe(summary);
		expect(trigger.attributes['aria-label']).toBe(
			`Provider, model, and reasoning: ${summary}`,
		);
		const menu = openMenu(trigger);
		expect(menuItem(menu, 'Custom', longModel).title).toBe(longModel);
	});
});
