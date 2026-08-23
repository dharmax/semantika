import {AbstractStorage, ICollection, IPhysicalCollection, StorageSession} from "../storage.js";
import {EntityDcr} from "../../descriptors.js";
import {MongoBasicCollection} from "./mongo-basic-collection.js";
import {SemanticPackage} from "../../semantic-package.js";
import {EntityCollection} from "../../entities-collection.js";
import {PredicateCollection} from "../../predicates-collection.js";

export class MongoStore extends AbstractStorage {
    private collections = {};
    public dbClient: any;

    constructor(uriOrClient: string | any) {
        super();
        if (typeof uriOrClient === "string") {
            try {
                // @ts-ignore
                const { MongoClient } = require("mongodb");
                this.dbClient = new MongoClient(uriOrClient);
            } catch {
                throw new Error("MongoDB driver not found. Please install 'mongodb' to use MongoStore: `npm install mongodb`");
            }
        } else {
            this.dbClient = uriOrClient;
        }
    }

    async connect() {
        return this.dbClient.connect();
    }

    async startSession(options?: any): Promise<StorageSession> {
        return this.dbClient.startSession(options);
    }

    async purgeDatabase() {
        this.collections = {};
        return await this.dbClient.db().dropDatabase();
    }

    async close() {
        return await this.dbClient.close();
    }

    async getPhysicalCollection(name: string): Promise<IPhysicalCollection> {
        return this.dbClient.db().collection(name);
    }

    makeEntityCollection(physicalCollection: IPhysicalCollection, eDcr: EntityDcr, initFunc: (col: EntityCollection) => void): EntityCollection {
        const c = new EntityCollection(eDcr, this.makeBasicCollection(physicalCollection));
        initFunc && initFunc(c);
        return c;
    }

    makePredicateCollection(semanticPackage: SemanticPackage, physicalCollection: IPhysicalCollection): PredicateCollection {
        return new PredicateCollection(semanticPackage, this.makeBasicCollection(physicalCollection));
    }

    makeBasicCollection(physicalCollection: IPhysicalCollection, initFunc?: (col: MongoBasicCollection) => void): ICollection {
        const c = new MongoBasicCollection(physicalCollection);
        initFunc && initFunc(c);
        return c;
    }
}
