/**
 * Compile src/ + tests/ with the TypeScript API (no child processes), then run
 * the test suite in-process.
 */
import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import ts from "typescript";

const require = createRequire(import.meta.url);
const outDir = ".test-build";
rmSync(outDir, { recursive: true, force: true });

const rootNames = ts.sys.readDirectory(
	"tests",
	[".ts"],
	undefined,
	undefined,
);
rootNames.push(...ts.sys.readDirectory("src", [".ts"]));

const options = {
	module: ts.ModuleKind.CommonJS,
	target: ts.ScriptTarget.ES2020,
	moduleResolution: ts.ModuleResolutionKind.Node10,
	outDir,
	rootDir: ".",
	esModuleInterop: true,
	allowSyntheticDefaultImports: true,
	strict: true,
	skipLibCheck: true,
	types: ["node"],
	lib: ["lib.dom.d.ts", "lib.es2020.d.ts"],
	sourceMap: false,
	declaration: false,
	noEmitOnError: true,
};

const program = ts.createProgram({ rootNames, options });
const emit = program.emit();
const diagnostics = ts
	.getPreEmitDiagnostics(program)
	.concat(emit.diagnostics)
	.filter((diagnostic) => {
		// Only fail on real errors, not on "no inputs" style noise.
		return diagnostic.category === ts.DiagnosticCategory.Error;
	});

if (diagnostics.length > 0) {
	console.error(
		ts.formatDiagnosticsWithColorAndContext(diagnostics, {
			getCanonicalFileName: (fileName) => fileName,
			getCurrentDirectory: () => process.cwd(),
			getNewLine: () => "\n",
		}),
	);
	process.exit(1);
}

require(`../${outDir}/tests/run.js`);
