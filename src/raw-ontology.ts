import {EntityDcr, PredicateDcr} from "./descriptors";

export interface IRawOntology {
    entityDcrs: EntityDcr[];
    predicateDcrs: PredicateDcr[];
}

export class RawOntology implements IRawOntology {
    constructor(public entityDcrs: EntityDcr[], public predicateDcrs: PredicateDcr[]) {
    }
    concat(...ont:RawOntology[]):RawOntology {
        for ( let o of ont) {
            this.entityDcrs.push( ...o.entityDcrs)
            this.predicateDcrs.push( ...o.predicateDcrs)
        }
        return this
    }
}
