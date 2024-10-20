import type { FlowAst, DataAsts, InstructionAst, WindowAst } from './ast'
import { clearClippies, ERROR, EvalError, makeClippyMessage, resetLoop, WARN } from './debug'
import { clearWindow, addSprite, type SpriteEngine, WindowEngine, makeWindow, TextEngine, addText } from './engine'
import { getPressedKeys, keys } from './input'
import { intersection } from './polyfills'

export const booleanType: EnumType = {
	kind: 'ENUM_TYPE',
	options: new Set([ 'yes', 'no' ]),
}
export function booleanTrue(at: SceneNode): EnumObj {
	return {
		kind: 'ENUM_OBJ',
		type: booleanType,
		selected: new Set([ 'yes' ]),
		at,
	}
}
export function booleanFalse(at: SceneNode): EnumObj {
	return {
		kind: 'ENUM_OBJ',
		type: booleanType,
		selected: new Set(['no']),
		at,
	}
}

export interface NumberType {
	kind: 'NUMBER_TYPE'
}

export interface StringType {
	kind: 'STRING_TYPE'
}

export interface GraphicType {
	kind: 'GRAPHIC_TYPE'
}

export interface SpriteType {
	kind: 'SPRITE_TYPE'
}

export interface TextType {
	kind: 'TEXT_TYPE'
}

export interface EnumType {
	kind: 'ENUM_TYPE'
	options: Set<string>
}

export interface GraphicType {
	kind: 'GRAPHIC_TYPE'
}

export interface FlowType {
	kind: 'FLOW_TYPE'
}

export interface ArrayType {
	kind: 'ARRAY_TYPE'
	item: Type
}

export interface AnyType {
	kind: 'ANY_TYPE'
}

export type Type =
	| NumberType
	| StringType
	| SpriteType
	| TextType
	| EnumType
	| GraphicType
	| FlowType
	| ArrayType
	| AnyType

// ---

export interface NumberObj {
	kind: 'NUMBER_OBJ'
	type: NumberType
	value: number
	at: SceneNode
}

export interface StringObj {
	kind: 'STRING_OBJ'
	type: StringType
	value: string
	at: SceneNode
}

export interface GraphicObj {
	kind: 'GRAPHIC_OBJ'
	type: GraphicType
	graphic: SceneNode
	at: SceneNode
}

export interface FlowObj {
	kind: 'FLOW_OBJ'
	type: FlowType
	node: FlowAst
	at: SceneNode
}

export interface SpriteObj {
	kind: 'SPRITE_OBJ'
	type: SpriteType
	engine: SpriteEngine
	at: SceneNode
}

export interface TextObj {
	kind: 'TEXT_OBJ'
	type: TextType
	engine: TextEngine
	at: SceneNode
}

export interface EnumObj {
	kind: 'ENUM_OBJ'
	type: EnumType
	selected: Set<string>
	at: SceneNode
}

export interface ArrayObj {
	kind: 'ARRAY_OBJ'
	type: ArrayType
	items: Obj[]
	at: SceneNode
}

export type Obj =
	| NumberObj
	| StringObj
	| SpriteObj
	| EnumObj
	| GraphicObj
	| TextObj
	| FlowObj
	| ArrayObj

export type ObjOfType<T extends Type> = Extract<Obj, { type: T }>

// ---

const stopFunctions: Map<string, () => void> = new Map()
const variables: Map<string, Obj> = new Map()

interface EvalContext {
	windowEngine: WindowEngine
	windowNode: SectionNode
	isDone: boolean
}

function getDataValue(data: DataAsts, ctx: EvalContext): Obj {
	switch (data.kind) {
		case 'GRAPHIC': {
			return {
				kind: 'GRAPHIC_OBJ',
				type: { kind: 'GRAPHIC_TYPE' },
				graphic: data.at,
				at: data.at
			}
		}
		case 'VARIABLE': {
			return variables.get(data.at.id)
				?? (data.propertyInitializer && getDataValue(data.propertyInitializer, ctx))
				?? ERROR(`variable '${data.name}' is not set.`, data.at)
		}
		case 'PROPERTY': {
			try {
				const evil: unknown = data.parent === 'CURRENT_WINDOW'
					? ctx.windowEngine
					: data.parent.kind === 'VARIABLE'
						// @ts-expect-error jank
						? getObjPrimitiveValue(variables.get(data.parent.at.id))
						: undefined
				return {
					kind: 'NUMBER_OBJ',
					type: { kind: 'NUMBER_TYPE' },
					// @ts-expect-error jank
					value: evil[data.name],
					at: data.at
				}
			} catch (error) {
				console.error('error reading property:')
				console.error(error)
				return ERROR('failed to read variable', data.at)
			}
		}
		case 'FLOW': {
			return {
				kind: 'FLOW_OBJ',
				type: { kind: 'FLOW_TYPE' },
				node: data,
				at: data.at
			}
		}
		case 'NUMBER': {
			return {
				kind: 'NUMBER_OBJ',
				type: { kind: 'NUMBER_TYPE' },
				value: data.value,
				at: data.at
			}
		}
		case 'STRING': {
			return {
				kind: 'STRING_OBJ',
				type: { kind: 'STRING_TYPE' },
				value: data.value,
				at: data.at
			}
		}
		case 'FILE': {
			return {
				kind: 'STRING_OBJ',
				type: { kind: 'STRING_TYPE' },
				value: data.data,
				at: data.at
			}
		}
	}
}

type PickArgsInput = { name: string | null, obj: Obj }

function typesEq(a: Type, b: Type): boolean {
	if (a.kind === 'ANY_TYPE' || b.kind === 'ANY_TYPE') return true
	if (a.kind !== b.kind) return false
	if (a.kind === 'ENUM_TYPE' && b.kind === 'ENUM_TYPE') {
		if (a.options.size !== b.options.size) return false
		if (intersection(a.options, b.options).size !== a.options.size) return false
	}
	if (a.kind === 'ARRAY_TYPE' && b.kind === 'ARRAY_TYPE') {
		return typesEq(a.item, b.item)
	}
	return true
}

function pickArgs(required: FnArg[], inputs: PickArgsInput[], at: SceneNode): Obj[] {
	inputs = [ ...inputs ]

	const args: Obj[] = []

	// Use named arguments.
	for (let i = 0; i < required.length; i++) {
		if (required[i].name === null) continue
		const inputIndex = inputs.findIndex(input => input.name === required[i].name)
		if (inputIndex === -1) continue
		args[i] = inputs[inputIndex].obj
		inputs.splice(inputIndex, 1)
	}

	// Process typed arguments.
	for (let i = 0; i < required.length; i++) {
		if (args[i]) continue
		const inputIndex = inputs.findIndex(input => typesEq(input.obj.type, required[i].type))
		if (inputIndex === -1) continue
		args[i] = inputs[inputIndex].obj
		inputs.splice(inputIndex, 1)
	}

	for (const input of inputs) WARN('extraneous input has been ignored.', input.obj.at)

	// Ensure we have all arguments.
	for (let i = 0; i < required.length; i++) {
		if (args[i]) continue

		let message = `missing argument of type '${required[i].type.kind}'`
		if (required[i].name !== null) message += ` with name '${required[i].name}'`
		message += ` at position ${i}.`

		throw new EvalError({ message, node: at })
	}

	return args
}

async function getInstructionValue(instruction: InstructionAst, ctx: EvalContext): Promise<Obj | null> {
	const inputs: PickArgsInput[] = instruction.inputs.map(input => {
		return {
			name: input.kind === 'VARIABLE' ? input.name : null,
			obj: getDataValue(input, ctx)
		}
	})

	switch (instruction.instruction.kind) {
		case 'LOOP': {
			if (!instruction.instruction.body) {
				WARN('loop has no body.', instruction.at)
				return null
			}

			const items = pickArgs([
				{ type: { kind: 'ARRAY_TYPE', item: { kind: 'ANY_TYPE' } } },
			], inputs, instruction.at)
			const array = items[0] as ArrayObj

			for (const item of array.items) {
				await setOutputs(instruction.outputs, item, ctx)
				await runInstructions(instruction.instruction.body, ctx)
			}

			return null
		}
		case 'FUNCTION': {
			const name = instruction.instruction.text
			if (name in builtinFnImpls) {
				const fn = builtinFnImpls[name as BuiltinFnNames]
				const args = pickArgs(fn.args, inputs, instruction.at)
				return await fn.impl(ctx, instruction.at, ...args)
			} else {
				return ERROR(`unknown builtin function call.`, instruction.at)
			}
		}
		case 'INFIX': {
			const fn = infixOperatorImpls[instruction.instruction.operator]

			if (instruction.instruction.left) {
				inputs.push({
					name: 'left',
					obj: getDataValue(instruction.instruction.left, ctx)
				})
			}
			if (instruction.instruction.right) {
				inputs.push({
					name: 'right',
					obj: getDataValue(instruction.instruction.right, ctx)
				})
			}

			const [ left, right ] = pickArgs([ fn.left, fn.right ], inputs, instruction.at)

			return await fn.impl(left, right, ctx, instruction.at)
		}
		case 'NUMBER': {
			return {
				kind: 'NUMBER_OBJ',
				type: { kind: 'NUMBER_TYPE' },
				value: instruction.instruction.value,
				at: instruction.at
			}
		}
		case 'STRING': {
			return {
				kind: 'STRING_OBJ',
				type: { kind: 'STRING_TYPE' },
				value: instruction.instruction.value,
				at: instruction.at
			}
		}
	}
}
function getObjPrimitiveValue(obj: Obj): unknown {
	switch (obj.kind) {
		case 'NUMBER_OBJ': return obj.value
		case 'GRAPHIC_OBJ': return obj.graphic
		case 'STRING_OBJ': return obj.value
		case 'ARRAY_OBJ': return obj.items.map(getObjPrimitiveValue)

		case 'SPRITE_OBJ':
		case 'TEXT_OBJ': return obj.engine

		default: ERROR(`cannot convert this ${obj.kind} into a primitive value.`, obj.at)
	}
}

async function setOutputs(outputs: DataAsts[], value: Obj, _ctx: EvalContext): Promise<void> {
	for (const output of outputs) {
		switch (output.kind) {
			case 'VARIABLE': {
				variables.set(output.at.id, value)
				break
			}

			case 'PROPERTY': {
				try {
					if (output.parent !== 'CURRENT_WINDOW' && output.parent.kind === 'VARIABLE') {
						const parent = variables.get(output.parent.at.id)
						if (parent !== undefined) {
							// @ts-expect-error jank
							getObjPrimitiveValue(variables.get(output.parent.at.id))[output.name] = getObjPrimitiveValue(value)
							break
						}
					}
				} catch (error) {
					console.error('error setting property:')
					console.error(error)
					return ERROR('failed to set variable', output.at ?? value.at)
				}

				return ERROR('fuck this shit.', output.at ?? value.at)
			}

			default: {
				if (!output.at) throw new Error('missing output at but need to error')
				ERROR(`this is a '${output.kind}' node and i don't know how to assign to it.`, output.at)
			}
		}
	}
}

async function runInstructions(instruction: InstructionAst | null, ctx: EvalContext) {
	// Instructions are executed from the last item backwards.
	const queue: InstructionAst[] = instruction ? [ instruction ] : []

	for (let instruction = queue.pop(); instruction; instruction = queue.pop()) {
		if (ctx.isDone) return
		if (instruction.next) queue.push(instruction.next)

		const value = await getInstructionValue(instruction, ctx)

		if (value?.kind === 'ENUM_OBJ' && instruction.matchArms) {
			for (const [ option, arm ] of instruction.matchArms) {
				if (value.selected.has(option)) {
					queue.push(arm)
				} else if (!value.type.options.has(option)) {
					WARN(`unknown enum value. valid: ${[ ...value.type.options ].map(v => `'${v}'`).join(', ')}`, instruction.at)
				}
			}
		}

		if (value) {
			await setOutputs(instruction.outputs, value, ctx)
		} else if (instruction.outputs.length > 0 && instruction.instruction.kind !== 'LOOP') {
			WARN(
				'not outputting anything because this function does not return anything.',
				instruction.outputs[0].at ?? instruction.at
			)
		}
	}
}

export async function play(window: WindowAst) {
	await clearClippies('WARNING')
	await clearClippies('ERROR')
	clearWindow(window.at)
	await stop(window)

	const ctx: EvalContext = {
		windowEngine: makeWindow(window.at),
		windowNode: window.at,
		isDone: false,
	}

	if (window.setup) {
		try {
			resetLoop()
			await runInstructions(window.setup.first, ctx)
		} catch (error) {
			if (error instanceof EvalError) {
				console.error('error in setup:')
				console.error(error)
				await makeClippyMessage('ERROR', error.originalMessage, error.node)
				await stop(window)
				return
			} else {
				throw error
			}
		}
	}

	const interval = setInterval(async () => {
		try {
			resetLoop()
			if (window.loop) await runInstructions(window.loop.first, ctx)
		} catch (error) {
			if (error instanceof EvalError) {
				console.error('error in loop:')
				console.error(error)
				await makeClippyMessage('ERROR', error.originalMessage, error.node)
				await stop(window)
			} else {
				throw error
			}
		}
	}, 1000 / 60)

	stopFunctions.set(window.at.id, () => {
		ctx.isDone = true
		clearInterval(interval)
	})
}

export async function stop(window: WindowAst) {
	clearWindow(window.at)

	const stopFunction = stopFunctions.get(window.at.id)
	if (stopFunction) {
		stopFunction()
		stopFunctions.delete(window.at.id)
	}
}

// ---

export interface FnArg {
	type: Type
	name?: string
}

export interface InfixOperatorImpl {
	left: FnArg
	right: FnArg
	impl(left: Obj, right: Obj, ctx: EvalContext, at: SceneNode): Promise<Obj>
}

export type InfixOperator = '/' | '-' | '*' | '+' | '<' | '>' | '<=' | '>=' | '%'

export const infixOperatorImpls: Record<InfixOperator, InfixOperatorImpl> = {
	'/': {
		left: { type: { kind: 'NUMBER_TYPE' }, name: 'left' },
		right: { type: { kind: 'NUMBER_TYPE' }, name: 'right' },
		async impl(left: NumberObj, right: NumberObj, _ctx: EvalContext, at: SceneNode) {
			return {
				kind: 'NUMBER_OBJ',
				type: { kind: 'NUMBER_TYPE' },
				value: left.value / right.value,
				at,
			}
		},
	},
	'%': {
		left: { type: { kind: 'NUMBER_TYPE' }, name: 'left' },
		right: { type: { kind: 'NUMBER_TYPE' }, name: 'right' },
		async impl(left: NumberObj, right: NumberObj, _ctx: EvalContext, at: SceneNode) {
			return {
				kind: 'NUMBER_OBJ',
				type: { kind: 'NUMBER_TYPE' },
				value: left.value % right.value,
				at,
			}
		},
	},
	'-': {
		left: { type: { kind: 'NUMBER_TYPE' }, name: 'left' },
		right: { type: { kind: 'NUMBER_TYPE' }, name: 'right' },
		async impl(left: NumberObj, right: NumberObj, _ctx: EvalContext, at: SceneNode) {
			return {
				kind: 'NUMBER_OBJ',
				type: { kind: 'NUMBER_TYPE' },
				value: left.value - right.value,
				at,
			}
		},
	},
	'*': {
		left: { type: { kind: 'NUMBER_TYPE' } },
		right: { type: { kind: 'NUMBER_TYPE' } },
		async impl(left: NumberObj, right: NumberObj, _ctx: EvalContext, at: SceneNode) {
			return {
				kind: 'NUMBER_OBJ',
				type: { kind: 'NUMBER_TYPE' },
				value: left.value * right.value,
				at,
			}
		},
	},
	'+': {
		left: { type: { kind: 'NUMBER_TYPE' } },
		right: { type: { kind: 'NUMBER_TYPE' } },
		async impl(left: NumberObj, right: NumberObj, _ctx: EvalContext, at: SceneNode) {
			return {
				kind: 'NUMBER_OBJ',
				type: { kind: 'NUMBER_TYPE' },
				value: left.value + right.value,
				at,
			}
		},
	},
	'<': {
		left: { name: 'left', type: { kind: 'NUMBER_TYPE' } },
		right: { name: 'right', type: { kind: 'NUMBER_TYPE' } },
		async impl(left: NumberObj, right: NumberObj, _ctx: EvalContext, at: SceneNode) {
			return left.value < right.value ? booleanTrue(at) : booleanFalse(at)
		},
	},
	'>': {
		left: { name: 'left', type: { kind: 'NUMBER_TYPE' } },
		right: { name: 'right', type: { kind: 'NUMBER_TYPE' } },
		async impl(left: NumberObj, right: NumberObj, _ctx: EvalContext, at: SceneNode) {
			return left.value > right.value ? booleanTrue(at) : booleanFalse(at)
		},
	},
	'<=': {
		left: { name: 'left', type: { kind: 'NUMBER_TYPE' } },
		right: { name: 'right', type: { kind: 'NUMBER_TYPE' } },
		async impl(left: NumberObj, right: NumberObj, _ctx: EvalContext, at: SceneNode) {
			return left.value <= right.value ? booleanTrue(at) : booleanFalse(at)
		},
	},
	'>=': {
		left: { name: 'left', type: { kind: 'NUMBER_TYPE' } },
		right: { name: 'right', type: { kind: 'NUMBER_TYPE' } },
		async impl(left: NumberObj, right: NumberObj, _ctx: EvalContext, at: SceneNode) {
			return left.value >= right.value ? booleanTrue(at) : booleanFalse(at)
		},
	},
}

export const infixOperators: InfixOperator[] = [ '>=', '<=', '>', '<', '+', '*', '/', '%', '-' ]

export interface BuiltinFnImpl {
	args: FnArg[]
	impl(ctx: EvalContext, at: SceneNode, ...args: Obj[]): Promise<Obj | null>
}

export type BuiltinFnNames =
	| 'add sprite'
	| 'add line'
	| 'call'
	| 'inputs'
	| 'colliding'
	| 'add text'
	| 'to string'
	| 'length'
	| 'index'
	| 'parse obj faces'
	| 'parse obj vertices'
	| 'debug log'
	| 'range'
	| 'yield'

export const builtinFnImpls: Record<BuiltinFnNames, BuiltinFnImpl> = {
	'add sprite': {
		args: [
			{ type: { kind: 'GRAPHIC_TYPE' } }
		],
		impl: async function (ctx: EvalContext, at: SceneNode, graphic: GraphicObj) {
			const sprite = addSprite(ctx.windowNode, graphic.graphic)

			return {
				kind: 'SPRITE_OBJ',
				type: { kind: 'SPRITE_TYPE' },
				engine: sprite,
				at,
			}
		},
	},
	'add text': {
		args: [],
		impl: async function(ctx: EvalContext, at: SceneNode) {
			return {
				kind: 'TEXT_OBJ',
				type: { kind: 'TEXT_TYPE' },
				engine: await addText(ctx.windowNode),
				at,
			}
		}
	},
	'add line': {
		args: [
			{
				name: 'start x',
				type: { kind: 'NUMBER_TYPE' }
			},
			{
				name: 'start y',
				type: { kind: 'NUMBER_TYPE' }
			},
			{
				name: 'end x',
				type: { kind: 'NUMBER_TYPE' }
			},
			{
				name: 'end y',
				type: { kind: 'NUMBER_TYPE' }
			}
		],
		impl: async function (
			ctx: EvalContext,
			at: SceneNode,
			startX: NumberObj,
			startY: NumberObj,
			endX: NumberObj,
			endY: NumberObj
		): Promise<GraphicObj> {
			const connector = figma.createConnector()
			connector.strokes = [ figma.util.solidPaint('#000000') ]
			connector.strokeWeight = 1
			connector.connectorLineType = "STRAIGHT"
			connector.connectorStart = {
				position: {
					x: startX.value,
					y: startY.value
				}
			}
			connector.connectorStartStrokeCap = 'NONE'
			connector.connectorEnd = {
				position: {
					x: endX.value,
					y: endY.value
				}
			}
			connector.connectorEndStrokeCap = 'NONE'
			ctx.windowNode.appendChild(connector)
			return {
				kind: 'GRAPHIC_OBJ',
				type: { kind: 'GRAPHIC_TYPE' },
				graphic: connector,
				at
			}
		}
	},
	'call': {
		args: [
			{ type: { kind: 'FLOW_TYPE' } }
		],
		impl: async function (ctx: EvalContext, _at: SceneNode, flow: FlowObj) {
			await runInstructions(flow.node.first, ctx)
			return null
		}
	},
	'range': {
		args: [
			{ type: { kind: 'NUMBER_TYPE'} },
		],
		impl: async function (_ctx: EvalContext, at: SceneNode, max: NumberObj): Promise<ArrayObj> {
			return {
				kind: 'ARRAY_OBJ',
				type: { kind: 'ARRAY_TYPE', item: { kind: 'NUMBER_TYPE' } },
				items: new Array(max.value).fill(null as unknown as NumberObj).map((_, index) => ({
					kind: 'NUMBER_OBJ',
					type: { kind: 'NUMBER_TYPE' },
					value: index,
					at,
				})),
				at,
			}
		}
	},
	'inputs': {
		args: [],
		impl: async function (_ctx: EvalContext, at: SceneNode,) {
			return {
				kind: 'ENUM_OBJ',
				type: { kind: 'ENUM_TYPE', options: new Set(keys) },
				selected: getPressedKeys(),
				at,
			}
		}
	},
	'colliding': {
		args: [
			{ type: { kind: 'SPRITE_TYPE' } },
			{ type: { kind: 'SPRITE_TYPE' } }
		],
		impl: async function(_ctx: EvalContext, at: SceneNode, a: SpriteObj, b: SpriteObj) {
			if (
				// @ts-expect-error jank
				a.engine.x < b.engine.x + b.engine.width &&
				// @ts-expect-error jank
				a.engine.x + a.engine.width > b.engine.x &&
				// @ts-expect-error jank
				a.engine.y < b.engine.y + b.engine.height &&
				// @ts-expect-error jank
				a.engine.y + a.engine.height > b.engine.y
			) {
				return booleanTrue(at)
			} else {
				return booleanFalse(at)
			}
		}
	},
	'to string': {
		args: [
			{ type: { kind: 'NUMBER_TYPE' } }
		],
		impl: async function(_ctx: EvalContext, at: SceneNode, number: NumberObj): Promise<StringObj> {
			return {
				kind: 'STRING_OBJ',
				type: { kind: 'STRING_TYPE' },
				value: number.value.toString(),
				at,
			}
		}
	},
	'length': {
		args: [
			{ type: { kind: 'ARRAY_TYPE', item: { kind: 'ANY_TYPE' } } }
		],
		impl: async function (_ctx: EvalContext, at: SceneNode, array: ArrayObj): Promise<NumberObj> {
			return {
				kind: 'NUMBER_OBJ',
				type: { kind: 'NUMBER_TYPE' },
				value: array.items.length,
				at,
			}
		}
	},
	'index': {
		args: [
			{ type: { kind: 'ARRAY_TYPE', item: { kind: 'ANY_TYPE' } } },
			{ type: { kind: 'NUMBER_TYPE' } },
		],
		impl: async function (_ctx: EvalContext, at: SceneNode, array: ArrayObj, index: NumberObj): Promise<Obj> {
			const item = array.items[index.value]
			if (!item) ERROR(`array index out of bounds: ${index.value} >= length ${array.items.length}.`, at)
			return item
		}
	},
	'parse obj faces': {
		args: [
			{ type: { kind: 'STRING_TYPE' } }
		],
		impl: async function(_ctx: EvalContext, at: SceneNode, file: StringObj): Promise<ArrayObj> {
			const indices: ArrayObj[] = file.value.split('\n').filter(line => /^f\s/.test(line)).map(line => {
				line = line.slice(1).trim()
				const coords: NumberObj[] = line.split(/\s+/g).map(index => {
					const value = Number.parseFloat(index)
					if (Number.isNaN(value)) ERROR(`could not parse obj: face '${index}' must is not a number.`, at)
					return {
						kind: 'NUMBER_OBJ',
						type: { kind: 'NUMBER_TYPE' },
						value: value - 1,
						at
					}
				})

				return {
					kind: 'ARRAY_OBJ',
					type: { kind: 'ARRAY_TYPE', item: { kind: 'NUMBER_TYPE' } },
					items: coords,
					at
				}
			})

			console.log(`loaded ${indices.length} faces`)

			return {
				kind: 'ARRAY_OBJ',
				type: { kind: 'ARRAY_TYPE', item: { kind: 'ARRAY_TYPE', item: { kind: 'NUMBER_TYPE' } } },
				items: indices,
				at
			}
		}
	},
	'parse obj vertices': {
		args: [
			{ type: { kind: 'STRING_TYPE' } }
		],
		impl: async function(_ctx: EvalContext, at: SceneNode, file: StringObj): Promise<Obj> {
			console.log(file.value)
			const vertices: ArrayObj[] = file.value.split('\n').filter(line => /^v\s/.test(line)).map(line => {
				line = line.slice(1).trim()
				const coords: NumberObj[] = line.split(/\s+/g).map(coord => {
					const value = Number.parseFloat(coord)
					if (Number.isNaN(value)) ERROR(`could not parse obj: vertex '${coord}' is not a number.`, at)
					return {
						kind: 'NUMBER_OBJ',
						type: { kind: 'NUMBER_TYPE' },
						value,
						at
					}
				})
				return {
					kind: 'ARRAY_OBJ',
					type: { kind: 'ARRAY_TYPE', item: { kind: 'NUMBER_TYPE' } },
					items: coords,
					at
				}
			})

			console.log(`loaded ${vertices.length} vertices`)

			return {
				kind: 'ARRAY_OBJ',
				type: { kind: 'ARRAY_TYPE', item: { kind: 'NUMBER_TYPE' } },
				items: vertices,
				at
			}
		}
	},
	'debug log': {
		args: [
			{ type: { kind: 'ANY_TYPE' } },
		],
		impl: async function(_ctx: EvalContext, _at: SceneNode, value: Obj): Promise<null> {
			console.log('debug log:', value)
			return null
		}
	},
	'yield': {
		args: [],
		impl: async function (): Promise<null> {
			await new Promise(resolve => setTimeout(resolve, 1))
			return null
		}
	}
}
