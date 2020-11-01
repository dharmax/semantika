import {PredicateDcr} from "./predicate-descriptor";

export interface IRawOntology {
    entityDcrs: Function[],
    predicateDcrs: PredicateDcr[]
}