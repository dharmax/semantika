# Semantika (a.k.a Semantix)
A very friendly semantic-graph database base layer.

## Motivation
Along the decades of programming i've accumulated, i found that semantic graphs as well as table and documents
are needed in almost all real-world applications, if you want a clean design/implementation and painless functional 
scalability. Reality simply dictates more and more connections and business logic that will be added - sometimes
on a daily basis - and such a multi-model approach provides a clean way to help with that, in the modeling
aspect. I implemented such a database layer several times, in different languages: One in C++, very special,
 for a rather special application, later on, twice in Java - both were rather extensive, the first was performance
 optimized and the later very extensive and supported also sophisticated semantic tagging, aspect-oriented based features, and more
and later on, a simple Javascript implementation, that expanded into a richer one which served be in a few
projects and supported also quite a few useful, advanced features. This is the evolution of the later,
stripped of any of the extra features and focused on the essence. The extra features would soon come
in separated libraries (on is already released: *am-i-allowed*) that are agnostic of even towards Semantix.

### Advantage vs. existing solutions
This layer is very agnostic, unlike anything else i've seen yet, and it evolved from several real-world
projects and yet it is brand new, without any tech debt, using the most modern language features.
It is built to be expanded, as i described above and it has some small unique features, but nothing, yet,
dramatic. i will make sure it continues to evolve elegantly, because that's what i like, and i'll listen
to your feedbacks.  

## General
It lets you connect entities with named predicates, for example:
 
 `George[:Person] ----worksFor[position:CTO]---> Hooli[:Company]`
 
 ...and easily query the graph.
 
 It also add an ontology, by which such predicates (=relations) and entity types could be defined
 as well as rules. It makes building even complex models very easy and readable.
 
 You can still work with the data as tables and documents when it suits you, or even 
 have collections that are "normal".
 
 Basically, it is agnostic to the underlying database engine but current it uses MongoDB.
 
 ## Status
 This library was already used in several projects, and it is in the process of revising as a standalone npm package.      
  
 ## Features
 1. Multi-model: Semantic Graph (entity and predicates model,AKA nodes and *semantic* edges and document/table model co-exist
 simultaneously with the goodies of both. 
 1. It connects with your classes and business logic extremely easily. 
 1. Database agnostic; provided with a MongoDB adapter and adding an adapter is trivial. You
 can even implement and use a mixture of a specialized tuple storage for the predicates with
 another storage for the entities.   
 1. Powerful entity field templates with joi validation.
 1. Pagination support in traversal
 1. All the normal per-collection/table/methods are still available
 
 ## Terminology 
 * **Entity** a node in the graph that may contain data in the form of fields and may connect to other
 entities view *Predicates*. It is an instant of a class of your own, which should extend `AbstractEntity`.
 * **Entity Descriptor** provides metadata per entity/entity-type, such as the implementing class, and
 the template (entity fields definition, validation, initializers, if needed...) and optionally things like
 extra index definitions and more.   
  * **Predicate** perdicates are the connection between the nodes (entities) of the graph (such as "owns", "likes", etc). You can also place a payload on a predicate instance (e.g. "levelOfLikeness") as well as define special keys to it (for special sort and searches)
  * **Predicat Descriptor** contains the metadata of a predicate, including its type ("owns", "likes") and its features (payload, keys) and its semantic parent if it has one. 
  * **Semantic Inheritence** if a predicate descriptor X, for example, is the parent of predicate Y, then a predicate query of X will return also the Ys.    
     
 
 # Usage
 ## Installation
 npm i semantix
 ## Preparations
 Basically. you need to:
 1. Have a *store* implementation, or use to provided `MongoStore` and connect to it.
 1. Define your ontology
     1. Create your model's entity classes by extending `AbstractEntity`,  with their *entity descriptors*.
     1. Create the *predicate descriptors*
 1. Instantiate a `SemanticPackage` and supply it with the *store* and the *ontology*
 1. You're ready to go: create entities, connect them, and so on
 
 ## Usage flow
 1. Your `SemanticPackage` instance is your main interface for most entity and predicate CRUD operations.
 1. Holding an entity, you can change, delete, and navigate through its predicates.
 1. That's it, basically

## Basic example
 
 ```ts

let sp: SemanticPackage
const storage = new MongoStorage('mongodb://localhost/testing-semantix');
await storage.connect()
await storage.purgeDatabase()
sp = new SemanticPackage('main', {
    entityDcrs: [Person.dcr, WorkPlace.dcr],
    predicateDcrs: [worksFor]
}, storage)

const george = <Person>await sp.createEntity(Person.dcr, {name: 'George'})
const hooli = <WorkPlace>await sp.createEntity(WorkPlace.dcr, {name: 'Hooli'})

const job = await sp.createPredicate(george, worksFor, hooli, {position: 'CTO'})

const foundPredicates = await hooli.incomingPreds(worksFor, {projection: ['name']})

// this `expect` is from the chai library
expect(foundPredicates.some(p => p.dcr === worksFor)).to.be.true;



class Person extends AbstractEntity {

    static template: EntityTemplate = {
        name: joi.string().required()
    };
    static readonly dcr = new EntityDcr(Person, Person.template)

}

class WorkPlace extends AbstractEntity {

    static template: EntityTemplate = {
        name: joi.string().required()
    };
    static readonly dcr = new EntityDcr(WorkPlace, WorkPlace.template)

}

const worksFor = new PredicateDcr('worksFor', [], {}, {
    position: joi.string(),
    start: joi.date(),
    end: joi.date(),
})

```
 
 
