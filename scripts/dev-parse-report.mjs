/**
 * Dev utility: run the contact parser over a real vault folder and print stats.
 * Usage: node scripts/dev-parse-report.mjs <customer-folder>
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../.test-build/src/core/contact-parser.js");

const dir = process.argv[2];
if (!dir) {
	console.error("usage: node scripts/dev-parse-report.mjs <customer-folder>");
	process.exit(1);
}

const files = fs
	.readdirSync(dir)
	.filter((name) => name.endsWith(".md"))
	.map((name) => path.join(dir, name));

let withHeading = 0;
let totalContacts = 0;
let sendable = 0;
let withoutEmail = 0;
let warnings = 0;
const samples = [];

for (const file of files) {
	const content = fs.readFileSync(file, "utf8");
	const parsed = core.parseContacts(content);
	if (parsed.headingFound) withHeading++;
	totalContacts += parsed.contacts.length;
	for (const contact of parsed.contacts) {
		if (contact.emails.length > 0) sendable++;
		else withoutEmail++;
	}
	warnings += parsed.warnings.length;
	if (parsed.warnings.length > 0 && samples.length < 6) {
		samples.push({
			file: path.basename(file),
			warnings: parsed.warnings.slice(0, 3),
		});
	}
}

console.log(
	JSON.stringify(
		{
			files: files.length,
			withHeading,
			totalContacts,
			sendable,
			withoutEmail,
			warnings,
			samples,
		},
		null,
		2,
	),
);
