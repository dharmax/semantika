import {SemanticPackage} from "./semantic-package.js";
import {IRawOntology} from "./raw-ontology.js";
import {LoggedException} from "./utils/logged-exception.js";
import {EntityDcr, PredicateDcr} from "./descriptors.js";

export class Ontology {
    private predicateDcrs: { [name: string]: PredicateDcr } = {};
    private entityDcrs: { [name: string]: EntityDcr } = {};

    constructor(readonly semanticPackage: SemanticPackage, readonly definitions: IRawOntology) {
        const self = this;
        let allPdcrs = this.predicateDcrs;

        process(definitions.predicateDcrs);

        function process(predicateDcrs: PredicateDcr[], parent: PredicateDcr = undefined) {
            definitions.entityDcrs.forEach(e => {
                self.entityDcrs[e.name] = e;
                self.entityDcrs[e.name].semanticPackage = semanticPackage;
            });
            for (let pd of predicateDcrs) {
                const e = allPdcrs[pd.name];
                if (e) {
                    if (e === pd) {
                        if (parent && !pd.parents.includes(parent)) {
                            pd.parents.push(parent);
                        }
                        continue;
                    }
                    throw new LoggedException('Duplicate predicate descriptor: ' + pd.name);
                }
                allPdcrs[pd.name] = pd;
                pd.semanticPackage = self.semanticPackage;
                pd.parents.forEach(pParent => {
                    if (!pParent.children.includes(pd))
                        pParent.children.push(pd);
                });
                if (parent && !pd.parents.includes(parent))
                    pd.parents.push(parent);

                pd.children && process(pd.children, pd);
            }
        }
    }

    pdcr(name: string): PredicateDcr {
        const res = this.predicateDcrs[name];
        if (!res)
            throw new LoggedException('No such predicate descriptor ' + name);
        return res;
    }

    edcr(name: string): EntityDcr {
        const res = this.entityDcrs[name];
        if (!res)
            throw new LoggedException('No such entity descriptor ' + name);
        return res;
    }

    pdcrNames(): string[] {
        return Object.keys(this.predicateDcrs);
    }

    edcrNames(): string[] {
        return Object.keys(this.entityDcrs);
    }

    get allEntityDcrs(): EntityDcr[] {
        return Object.values(this.entityDcrs);
    }

    get allPredicateDcrs(): PredicateDcr[] {
        return Object.values(this.predicateDcrs);
    }

    toJSON() {
        return {
            packageName: this.semanticPackage.name,
            entities: Object.values(this.entityDcrs).map(e => e.toJSON()),
            predicates: Object.values(this.predicateDcrs).map(p => p.toJSON())
        };
    }

    exportSchema() {
        return {
            semanticPackage: this.semanticPackage.name,
            entities: Object.fromEntries(Object.entries(this.entityDcrs).map(([name, dcr]) => [name, dcr.toJSON()])),
            predicates: Object.fromEntries(Object.entries(this.predicateDcrs).map(([name, dcr]) => [name, dcr.toJSON()]))
        };
    }

    postProcess() {
        Object.values(this.predicateDcrs).forEach(async dcr => {
            if (!dcr.keys)
                return;
            const col = await this.semanticPackage.predicateCollection(dcr);
            Object.values(dcr.keys).forEach(entry => {
                const kArray: string[] = Object.values(entry);
                kArray.forEach(k => {
                    col.ensureIndex({sourceId: 1, [k]: 1, targetId: 1});
                    col.ensureIndex({targetId: 1, [k]: 1, sourceId: 1});
                });
            });
        });
    }
}