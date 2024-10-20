export const keys = [ 'up', 'down', 'left', 'right' ] as const

export type Key = typeof keys[number]

const pressedKeys: Set<Key> = new Set()

export function interpretBrowserKeys(browserKeys: Set<string>): Set<Key> {
	const keys: Set<Key> = new Set()

	for (const browserKey of browserKeys) {
		const key: Key | null = ({
			ArrowUp: 'up',
			ArrowDown: 'down',
			ArrowLeft: 'left',
			ArrowRight: 'right',
		} as const)[browserKey] ?? null

		if (key !== null) keys.add(key)
	}

	return keys
}

export function updatePressedKeys(newPressedKeys: Set<Key>): void {
	let dirty = false

	for (const key of newPressedKeys) {
		if (!pressedKeys.has(key)) {
			pressedKeys.add(key)
			dirty = true
		}
	}

	for (const key of pressedKeys) {
		if (!newPressedKeys.has(key)) {
			pressedKeys.delete(key)
			dirty = true
		}
	}
}

export function getPressedKeys(): Set<Key> {
	return pressedKeys
}
