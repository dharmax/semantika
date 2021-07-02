import {EntityDcr, PredicateDcr} from "./descriptors";

export class IRawOntology {
    entityDcrs: EntityDcr[]
    predicateDcrs: PredicateDcr[]

    concat(...ont:IRawOntology[]):IRawOntology {
        for ( let o of ont) {
            this.entityDcrs.push( ...o.entityDcrs)
            this.predicateDcrs.push( ...o.predicateDcrs)
        }
        return this
    }
}
