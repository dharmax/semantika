import {SemanticPackage} from "./semantic-package";
import {IRawOntology} from "./raw-ontology";
import {LoggedException} from "./utils/logged-exception";
import {EntityDcr, PredicateDcr} from "./descriptors";

export class Ontology {
    private predicateDcrs: { [name: string]: PredicateDcr } = {}
    private entityDcrs: { [name: string]: EntityDcr } = {}

    constructor(readonly semanticPackage: SemanticPackage, readonly definitions: IRawOntology) {
        const self = this
        definitions.entityDcrs.forEach(e => this.entityDcrs[e.name] = e)
        let allPdcrs = this.predicateDcrs

        process(definitions.predicateDcrs)

        function process(predicateDcrs: PredicateDcr[], parent: PredicateDcr = undefined) {
            for (let pd of predicateDcrs) {
                const e = allPdcrs[pd.name]
                if (e)
                    throw new LoggedException('Duplicate predicate descriptor: ' + pd.name)
                allPdcrs[pd.name] = pd
                pd.semanticPackage = self.semanticPackage
                pd.parents.forEach(pParent => {
                    if (!pParent.children.includes(pd))
                        pParent.children.push(pd)
                })
                if (parent && !pd.parents.includes(parent))
                    pd.parents.push(parent)

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

    edcr(name: string): EntityDcr {
        const res = this.entityDcrs[name]
        if (!res)
            throw new LoggedException('No such predicate descriptor ' + name)
        return res
    }

    edcrNames() {
        return Object.keys(this.entityDcrs)
    }
}