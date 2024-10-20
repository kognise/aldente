import { compilePage } from './ast'
import { resetLoop } from './debug'
import { play, stop } from './eval'
import { interpretBrowserKeys, updatePressedKeys } from './input'
import { difference } from './polyfills'

async function main() {
	let previousButtons: Set<string> = new Set()
	figma.on('selectionchange', async () => {
		resetLoop()
		const windows = await compilePage(figma.currentPage)

		const buttons = new Set(figma.currentPage.selection.map(button => button.id))
		const newButtons = difference(buttons, previousButtons)
		previousButtons = buttons
		if (newButtons.size > 1) return

		const playWindows = new Set(windows.filter(window => window.playButtons.some(button => newButtons.has(button.id))))
		const stopWindows = new Set(windows.filter(window => window.stopButtons.some(button => newButtons.has(button.id))))

		for (const window of playWindows) await play(window)
		for (const window of stopWindows) await stop(window)
	})

	figma.showUI(__html__, { height: 100, width: 300 })

	figma.ui.on('message', (message) => {
		switch (message.kind) {
			case 'UPDATE_PRESSED_KEYS': {
				const rawPressedKeys = new Set(message.pressedKeys as string[])
				updatePressedKeys(interpretBrowserKeys(rawPressedKeys))
				break
			}
			default: console.warn('unknown message:', message)
		}
	})
}

// /**
//  * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set/difference
//  */
// function setDifference<T>(superset: Set<T>, subset: Set<T>): Set<T> {
// 	const difference: Set<T> = new Set()
// 	for (const item of superset) {
// 		if (!subset.has(item)) difference.add(item)
// 	}
// 	return difference
// }

main().catch(console.error)
