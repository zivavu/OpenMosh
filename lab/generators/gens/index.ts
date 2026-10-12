import type { Generator } from "../kit";
import { attractor } from "./attractor";
import { automata } from "./automata";
import { bauhaus } from "./bauhaus";
import { chladni } from "./chladni";
import { cutout } from "./cutout";
import { flowfield } from "./flowfield";
import { macroblock } from "./macroblock";
import { marbling } from "./marbling";
import { reaction } from "./reaction";
import { risograph } from "./risograph";
import { testcard } from "./testcard";
import { truchet } from "./truchet";

export const GENERATORS: Generator[] = [
	risograph,
	bauhaus,
	truchet,
	cutout,
	testcard,
	macroblock,
	automata,
	attractor,
	flowfield,
	marbling,
	chladni,
	reaction,
];
