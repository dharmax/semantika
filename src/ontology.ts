import {AbstractEntity} from "./abstract-entity";
import {SemanticPackage} from "./semantic-package";
import {IRawOntology} from "./raw-ontology";
import {LoggedException} from "./utils/logged-exception";
import {PredicateDcr} from "./descriptors";

export class Ontology {
    private predicateDcrs: { [name: string]: PredicateDcr } = {}
    private entityDcrs: { [name: string]: { clazz: typeof AbstractEntity } } = {}

    constructor(readonly semanticPackage: SemanticPackage, readonly definitions: IRawOntology) {
        definitions.entityDcrs.forEach(e => this.entityDcrs[e.name] = {clazz: e})
        let allPdcrs = this.predicateDcrs
        process(definitions.predicateDcrs)

        const self = this

        function process(predicateDcrs: PredicateDcr[], parent: PredicateDcr = undefined) {
            for (let pd of predicateDcrs) {
                const e = allPdcrs[pd.name]
                if (e)
                    throw new LoggedException('Duplicate predicate descriptor: ' + pd.name)
                allPdcrs[pd.name] = pd
                pd.semanticPackage = self.semanticPackage
                if (pd.parent) {
                    if (parent)
                        throw new LoggedException(`Attempt to override predicate parent ${pd.parent}in descriptor ${pd.name}`)
                    parent.children.push(pd)
                }
                pd.parent = parent
                pd.children && process(pd.children)
            }
        }
    }

    pdcr(name: string): PredicateDcr {
        const res = this.predicateDcrs[name]
        if (!res)
            throw new LoggedException('No such predicate descriptor ' + name)
        return res
    }

    edcr(name: string) {
        const res = this.entityDcrs[name]
        if (!res)
            throw new LoggedException('No such predicate descriptor ' + name)
        return res
    }

    edcrNames() {
        return Object.keys(this.entityDcrs)
    }
}