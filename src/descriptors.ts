import {SemanticPackage} from "./semantic-package";
import {AbstractEntity} from "./abstract-entity";
import {EntityTemplate} from "./utils/template-processor";
import {EntityCollection} from "./storage/semantic-collections";

export abstract class SemanticPartDescriptor {
    semanticPackage: SemanticPackage;
    _parents: SemanticPartDescriptor[] = []
}

export class EntityDcr extends SemanticPartDescriptor {
    initializer: (col: EntityCollection) => void;
    collectionName: string;

    constructor(readonly clazz: typeof AbstractEntity, readonly template: EntityTemplate) {
        super();
    }

    get name(): string {
        return this.clazz.name;
    }

    get parents() {
        return this._parents as EntityDcr[]
    }
}

export class PredicateDcr extends SemanticPartDescriptor {

    get parents() {
        // @ts-ignore
        return this._parents as PredicateDcr[]
    }

    constructor(readonly name: string, public children: PredicateDcr[] = [],
                readonly keys: { source?: string[], target?: string[], self?: string[] } = {
                    source: [],
                    target: [],
                    self: []
                }, readonly payload?: EntityTemplate, public rules?: any) {
        super()
    }
}