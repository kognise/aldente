import { checkLoop, clearClippies, WARN } from './debug'
import { type InfixOperator, infixOperators } from './eval'

export type Asts =
	| WindowAst
	| GraphicAst
	| FileAst
	| InstructionAst
	| FlowAst
	| FunctionAst
	| NumberAst
	| StringAst
	| InfixAst
	| VariableAst
	| PropertyAst
	| LoopAst
export type AstByKind<Kind extends Asts['kind']> = Extract<Asts, { kind: Kind }>

export interface WindowAst {
	kind: 'WINDOW'
	playButtons: SceneNode[]
	stopButtons: SceneNode[]
	setup: FlowAst | null
	loop: FlowAst | null
	at: SectionNode
}

export interface GraphicAst {
	kind: 'GRAPHIC'
	at: SceneNode
}

export interface FileAst {
	kind: 'FILE'
	data: string
	at: SceneNode
}

export interface FunctionAst {
	kind: 'FUNCTION'
	text: string
	at: TextNode
}

export interface InfixAst {
	kind: 'INFIX'
	operator: InfixOperator
	left: NumberAst | StringAst | PropertyAst | null
	right: NumberAst | StringAst | PropertyAst | null
	at: TextNode
}

export interface NumberAst {
	kind: 'NUMBER'
	value: number
	at: SceneNode
}

export interface StringAst {
	kind: 'STRING'
	value: string
	at: SceneNode
}

export interface VariableAst {
	kind: 'VARIABLE'
	name: string
	propertyInitializer: PropertyAst | null
	at: ShapeWithTextNode
}

export interface PropertyAst {
	kind: 'PROPERTY'
	name: string
	parent: DataAsts | 'CURRENT_WINDOW'
	at: SceneNode
}

export interface LoopAst {
	kind: 'LOOP'
	body: InstructionAst | null
	at: TextNode
}

export type InstructionInnerAsts =
	| FunctionAst
	| NumberAst
	| StringAst
	| InfixAst
	| LoopAst

export interface InstructionAst {
	kind: 'INSTRUCTION'
	instruction: InstructionInnerAsts
	inputs: DataAsts[]
	outputs: DataAsts[]
	matchArms: Map<string, InstructionAst> | null
	next: InstructionAst | null
	at: TextNode
}

export type DataAsts =
	| FlowAst
	| GraphicAst
	| FileAst
	| VariableAst
	| PropertyAst
	| NumberAst
	| StringAst

export interface FlowAst {
	kind: 'FLOW'
	name: string
	first: InstructionAst | null
	at: TextNode
}

export async function compilePage(page: PageNode): Promise<WindowAst[]> {
	await clearClippies('WARNING')

	const windows: WindowAst[] = []

	const ctx: CompileContext = {}

	for (const node of page.children) {
		if (node.type !== 'SECTION') continue
		windows.push(await compileWindow(node, ctx))
	}

	return windows
}

interface CompileContext {}

interface ConnectorDirections {
	incomingArrows: SceneNode[]
	outgoingArrows: SceneNode[]
	next: SceneNode[]
}

async function getConnections(node: SceneNode): Promise<ConnectorDirections> {
	checkLoop()

	const incomingArrows: SceneNode[] = []
	const outgoingArrows: SceneNode[] = []
	const next: SceneNode[] = []

	for (const connector of node.attachedConnectors) {
		if (!('endpointNodeId' in connector.connectorStart)) continue
		if (!('endpointNodeId' in connector.connectorEnd)) continue
		if (connector.connectorStart.endpointNodeId === connector.connectorEnd.endpointNodeId) continue

		const polarized = connector.connectorStart.endpointNodeId === node.id
			? {
				thisCap: connector.connectorStartStrokeCap,
				otherNode: (await figma.getNodeByIdAsync(connector.connectorEnd.endpointNodeId)) as SceneNode,
				otherCap: connector.connectorEndStrokeCap
			}
			: {
				thisCap: connector.connectorEndStrokeCap,
				otherNode: (await figma.getNodeByIdAsync(connector.connectorStart.endpointNodeId)) as SceneNode,
				otherCap: connector.connectorStartStrokeCap
			}

		if (polarized.otherCap !== 'NONE') {
			outgoingArrows.push(polarized.otherNode)
		} else if (polarized.thisCap !== 'NONE') {
			incomingArrows.push(polarized.otherNode)
		} else if (connector.connectorEnd.endpointNodeId !== node.id) {
			next.push((await figma.getNodeByIdAsync(connector.connectorEnd.endpointNodeId)) as SceneNode)
		}
	}

	// Sort next top-to-bottom.
	next.sort((a, b) => a.y - b.y)

	return { incomingArrows, outgoingArrows, next }
}

async function compileData(node: SceneNode, ctx: CompileContext): Promise<DataAsts | null> {
	if (node.type === 'SHAPE_WITH_TEXT') {
		const text = node.text.characters.trim()

		if (text.length > 0) {
			if (node.shapeType === 'SQUARE') {
				const { incomingArrows } = await getConnections(node)
				const inputs = []
				for (const incomingArrow of incomingArrows) {
					if (incomingArrow.type !== 'SHAPE_WITH_TEXT' || incomingArrow.shapeType !== 'ELLIPSE') continue
					const input = await compileData(incomingArrow, ctx)
					if (input) inputs.push(input)
				}

				return {
					kind: 'VARIABLE',
					name: text,
					propertyInitializer: inputs.find(input => input.kind === 'PROPERTY') ?? null,
					at: node,
				}
			}

			if (node.shapeType === 'ELLIPSE') {
				// Property.

				const { incomingArrows } = await getConnections(node)

				const validParents: DataAsts[] = []
				for (const incomingArrow of incomingArrows) {
					if (incomingArrow.type === 'SHAPE_WITH_TEXT') {
						const data = await compileData(incomingArrow, ctx)
						if (data) validParents.push(data)
					}
				}

				if (validParents.length > 1) {
					WARN(`property '${text}' has more than one valid parents, only one will be used.`, node)
				}

				return {
					kind: 'PROPERTY',
					name: text,
					parent: validParents[0] ?? 'CURRENT_WINDOW',
					at: node,
				}
			}

			if (node.shapeType === 'ENG_DATABASE') {
				// File.

				return {
					kind: 'FILE',
					data: text,
					at: node
				}
			}
		}

		return {
			kind: 'GRAPHIC',
			at: node,
		}
	}

	if (node.type === 'TEXT') return await compileFlow(node, ctx)

	WARN(`could not interpret this data, it will be ignored.`, node)
	return null
}

function tryParseAsNumber(text: string): number | null {
	text = text.trim()
	if (!/^-?(?:\d*\.)?\d+$/.test(text)) return null
	return parseFloat(text)
}

function tryParseAsString(text: string): string | null {
	text = text.trim()
	if (!/^[/“”"/].*[/“”"/]$/.test(text)) return null
	return text.slice(1, -1)
}

async function compileInfixSide(text: string, _ctx: CompileContext, at: SceneNode): Promise<NumberAst | StringAst | PropertyAst | null> {
	text = text.trim()

	const number = tryParseAsNumber(text)
	if (number !== null) {
		return {
			kind: 'NUMBER',
			value: number,
			at,
		}
	}

	const string = tryParseAsString(text)
	if (string !== null) {
		return {
			kind: 'STRING',
			value: string,
			at,
		}
	}

	if (text.length > 0) {
		return {
			kind: 'PROPERTY',
			name: text,
			parent: 'CURRENT_WINDOW',
			at,
		}
	}

	return null
}

async function compileInstruction(node: TextNode, ctx: CompileContext): Promise<InstructionAst> {
	const { inputs, outputs } = await getInputsAndOutputs(node, ctx)
	const text = node.characters.trim()

	async function getInner(node: TextNode): Promise<InstructionInnerAsts> {
		if (text === 'loop') {
			return {
				kind: 'LOOP',
				body: await compileInstructions(node, ctx),
				at: node,
			}
		}

		const number = tryParseAsNumber(text)
		if (number !== null) {
			return {
				kind: 'NUMBER',
				value: number,
				at: node,
			}
		}

		const string = tryParseAsString(text)
		if (string !== null) {
			return {
				kind: 'STRING',
				value: string,
				at: node,
			}
		}

		for (const operator of infixOperators) {
			const [ leftText, rightText, ...rest ] = text.split(operator)

			if (rightText === undefined) continue
			if (rest.length > 0) WARN('too many operands passed to infix operator.', node)

			return {
				kind: 'INFIX',
				operator,
				left: await compileInfixSide(leftText, ctx, node),
				right: await compileInfixSide(rightText, ctx, node),
				at: node,
			}
		}

		return {
			kind: 'FUNCTION',
			text: text,
			at: node,
		}
	}

	const instruction = await getInner(node)

	if (instruction.kind === 'LOOP') {
		return {
			kind: 'INSTRUCTION',
			next: null,
			matchArms: null,
			instruction,
			inputs,
			outputs,
			at: node,
		}
	}

	if (node.fontName === figma.mixed) WARN('mixed font detected, cannot detect italics.', node)

	if (node.fontName !== figma.mixed && node.fontName.style.includes('Italic')) {
		const { next } = await getConnections(node)

		const matchArms: Map<string, InstructionAst> = new Map()

		for (const destination of next) {
			if (destination.type !== 'TEXT') {
				WARN('cannot match against non-text.', destination)
				continue
			}

			const destinationText = destination.characters.trim()
			if (matchArms.has(destinationText)) {
				WARN(`duplicate match arm, one will be ignored.`, destination)
			}

			const nextInstruction = await compileInstructions(destination, ctx)
			if (nextInstruction) matchArms.set(destinationText, nextInstruction)
		}

		return {
			kind: 'INSTRUCTION',
			next: null,
			matchArms,
			instruction,
			inputs,
			outputs,
			at: node,
		}
	}

	return {
		kind: 'INSTRUCTION',
		next: await compileInstructions(node, ctx),
		matchArms: null,
		instruction,
		inputs,
		outputs,
		at: node,
	}
}

function getTail(instruction: InstructionAst): InstructionAst {
	checkLoop()
	if (!instruction.next) return instruction
	return getTail(instruction.next)
}

async function compileInstructions(node: SceneNode, ctx: CompileContext): Promise<InstructionAst | null> {
	const { next } = await getConnections(node)
	const nextText: TextNode[] = []
	for (const node of next) {
		if (node.type === 'TEXT') {
			nextText.push(node)
		} else {
			WARN(`node type '${node.type}' cannot be a valid instruction.`, node)
		}
	}
	if (nextText.length === 0) return null

	const first: InstructionAst = await compileInstruction(nextText[0], ctx)

	let last: InstructionAst = getTail(first)
	for (const subsequent of nextText.slice(1)) {
		if (last.next) {
			WARN('something horrible happened because this tried to overwrite an instruction.', subsequent)
			continue
		}

		last.next = await compileInstruction(subsequent, ctx)
		last = getTail(last.next)
	}

	return first
}

async function compileFlow(node: TextNode, ctx: CompileContext): Promise<FlowAst> {
	return {
		kind: 'FLOW',
		name: node.characters,
		first: await compileInstructions(node, ctx),
		at: node,
	}
}

export async function compileWindow(node: SectionNode, ctx: CompileContext): Promise<WindowAst> {
	const { incomingArrows, outgoingArrows } = await getConnections(node)

	let setup: FlowAst | null = null
	let loop: FlowAst | null = null

	for (const node of outgoingArrows) {
		if (node.type !== 'TEXT') {
			WARN(`unknown node type '${node.type}' as child of window.`, node)
			continue
		}

		if (node.characters === 'setup') {
			if (setup) {
				WARN(`duplicate setup function! ignoring.`, node)
				continue
			}
			setup = await compileFlow(node, ctx)
		} else if (node.characters === 'loop') {
			if (loop) {
				WARN(`duplicate loop function! ignoring.`, node)
				continue
			}
			loop = await compileFlow(node, ctx)
		} else {
			WARN(`unknown flow '${node.characters}' on window.`, node)
		}
	}

	const playButtons = incomingArrows.filter(node => {
		if (node.type === 'SHAPE_WITH_TEXT' && node.shapeType === 'TRIANGLE_UP') return true
		return false
	})

	const stopButtons = incomingArrows.filter(node => {
		if (node.type === 'SHAPE_WITH_TEXT' && node.shapeType === 'SQUARE') return true
		return false
	})

	return {
		kind: 'WINDOW',
		playButtons,
		stopButtons,
		setup,
		loop,
		at: node,
	}
}

interface InputsAndOutputs {
	inputs: DataAsts[]
	outputs: DataAsts[]
}

async function getInputsAndOutputs(node: SceneNode, ctx: CompileContext): Promise<{ inputs: DataAsts[], outputs: DataAsts[] }> {
	const { incomingArrows, outgoingArrows } = await getConnections(node)

	const inputsAndOutputs: InputsAndOutputs = {
		inputs: [],
		outputs: [],
	}

	for (const incomingArrow of incomingArrows) {
		const input = await compileData(incomingArrow, ctx)
		if (input) inputsAndOutputs.inputs.push(input)
	}

	for (const outgoingArrow of outgoingArrows) {
		const output = await compileData(outgoingArrow, ctx)
		if (output) inputsAndOutputs.outputs.push(output)
	}

	return inputsAndOutputs
}
