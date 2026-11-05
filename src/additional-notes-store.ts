export class AdditionalNotesStore {
	private selections = new Map<string, string[]>();
	private readonly listeners = new Set<() => void>();

	list(targetPath: string): readonly string[] {
		return [...(this.selections.get(targetPath) ?? [])];
	}

	add(targetPath: string, notePath: string): boolean {
		if (targetPath === notePath) {
			return false;
		}
		const selected = this.selections.get(targetPath) ?? [];
		if (selected.includes(notePath)) {
			return false;
		}
		selected.push(notePath);
		this.selections.set(targetPath, selected);
		this.notify();
		return true;
	}

	remove(targetPath: string, notePath: string): void {
		const selected = this.selections.get(targetPath);
		if (!selected?.includes(notePath)) {
			return;
		}
		const remaining = selected.filter((path) => path !== notePath);
		if (remaining.length === 0) {
			this.selections.delete(targetPath);
		} else {
			this.selections.set(targetPath, remaining);
		}
		this.notify();
	}

	clear(targetPath: string): void {
		if (this.selections.delete(targetPath)) {
			this.notify();
		}
	}

	rename(oldPath: string, newPath: string): void {
		if (oldPath === newPath) {
			return;
		}
		let changed = false;
		const renamedSelections = new Map<string, string[]>();
		for (const [targetPath, selected] of this.selections) {
			const renamedTarget = targetPath === oldPath ? newPath : targetPath;
			changed ||= renamedTarget !== targetPath;
			const renamed = selected.map((path) => {
				if (path === oldPath) {
					changed = true;
					return newPath;
				}
				return path;
			});
			const withoutActive = renamed.filter((path) => path !== renamedTarget);
			changed ||= withoutActive.length !== renamed.length;
			const merged = [...(renamedSelections.get(renamedTarget) ?? []), ...withoutActive];
			const deduplicated = merged.filter((path, index) => merged.indexOf(path) === index);
			changed ||= deduplicated.length !== merged.length;
			renamedSelections.set(renamedTarget, deduplicated);
		}
		if (!changed) {
			return;
		}
		this.selections = renamedSelections;
		this.notify();
	}

	removeDeleted(notePath: string): void {
		let changed = false;
		for (const [targetPath, selected] of this.selections) {
			if (!selected.includes(notePath)) {
				continue;
			}
			this.selections.set(
				targetPath,
				selected.filter((path) => path !== notePath),
			);
			changed = true;
		}
		if (changed) {
			this.notify();
		}
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}
