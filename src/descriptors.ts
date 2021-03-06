import {SemanticPackage} from "./semantic-package";
import {AbstractEntity} from "./abstract-entity";
import {EntityTemplate} from "./utils/template-processor";
import {EntityCollection} from "./entities-collection";

/**
 * This is the abstract parent of all descriptors. Descriptors are the ontology of your model and as ontologies go, they
 * can be hierarchical which means, a descriptor inherits the *semantic meaning* of its parent - a useful fact that
 * reflects on the queries you can make. As with their counterparts, (entities and predicates) they belong to semantic-packages
 * where the rules of inheritance also apply.
 */
export abstract class SemanticPartDescriptor {
    protected semanticPackageName: string;
    _parents: SemanticPartDescriptor[] = []

    // an optionally alternative collection name. By default, the name is automatically determined according to the type
    collectionName: string;

    get semanticPackage() {
        return SemanticPackage.findSemanticPackage(this.semanticPackageName)
    }

    set semanticPackage(sp: SemanticPackage) {
        this.semanticPackageName = sp.name
    }
}

/**
 * Holds meta-data for an entity-type and semantically defines it. Usually, a entity type is represented by its own JS
 * class but theoretically one JS class may represent more than one entity type, but they must have separate descriptors.
 */
export class EntityDcr extends SemanticPartDescriptor {
    /**
     * optional special initializer for the associated collection. You can add special indexes there, for example
     */
    initializer: (col: EntityCollection) => void;

    /**
     * @param clazz the JS class that represents the entity type
     * @param template the template definition of the entities' fields
     * @param _name (optional) alternative name for the dcr (it's the class name by default)
     */
    constructor(readonly clazz: typeof AbstractEntity, readonly template: EntityTemplate, private _name?: string) {
        super();
    }

    get name(): string {
        return this._name || this.clazz.name;
    }

    get parents() {
        return this._parents as EntityDcr[]
    }
}

/**
 * Predicate descriptor denotes the type of the descriptor and it's supposed to have a semantically meaningful name to
 * the relevant business logic.
 */
export class PredicateDcr extends SemanticPartDescriptor {

    get parents() {
        // @ts-ignore
        return this._parents as PredicateDcr[]
    }

    /**
     *
     * @param name the meaningful name of these predicates
     * @param children sub-predicates
     * @param keys optional extra keys (indexed)
     * @param payload template for user payload
     * @param rules rules for what may be connected by the predicate
     */
    constructor(readonly name: string, public children: PredicateDcr[] = [],
                readonly keys?: { source?: string[], target?: string[], self?: string[] }, readonly payload?: EntityTemplate, public rules?: any) {
        super()
    }
}