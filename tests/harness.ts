export type TestFn = () => void | Promise<void>;

interface TestCase {
	name: string;
	fn: TestFn;
}

const cases: TestCase[] = [];
let currentSuite = "";

export function suite(name: string): void {
	currentSuite = name;
}

export function test(name: string, fn: TestFn): void {
	cases.push({ name: currentSuite ? `${currentSuite} › ${name}` : name, fn });
}

export function assert(condition: unknown, message: string): void {
	if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
	const a = JSON.stringify(actual);
	const b = JSON.stringify(expected);
	if (a !== b) {
		throw new Error(`${message}\n  实际: ${a}\n  期望: ${b}`);
	}
}

export function assertThrows(fn: () => unknown, message: string): void {
	try {
		fn();
	} catch {
		return;
	}
	throw new Error(message);
}

export async function runAll(): Promise<void> {
	let failed = 0;
	for (const testCase of cases) {
		try {
			await testCase.fn();
			console.log(`  \u2713 ${testCase.name}`);
		} catch (error) {
			failed++;
			console.error(`  \u2717 ${testCase.name}`);
			console.error(
				`    ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
			);
		}
	}
	console.log("");
	console.log(
		failed === 0
			? `PASS ${cases.length} tests`
			: `FAIL ${failed}/${cases.length} tests`,
	);
	if (failed > 0) process.exit(1);
}
