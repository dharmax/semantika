# Semantix
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
 1. Database agnostic; provided with a MongoDB adapter and adding an adapter is trivial.  
 1. Powerful entity field templates with joi validation.
 1. Pagination support in traversal
 1. All the normal per-collection/table methods are still avai
 
 ## Terminology 
 * **Entity** a node in the graph that may contain data in the form of fields and may connect to other
 entities view *Predicates*. It is an instant of a class of your own, which should extend `AbstractEntity`.
 * **Entity Descriptor** provides metadata per entity/entity-type, such as the implementing class, and
 the template (entity fields definition, validation, initializers, if needed...) and optionally things like
 extra index definitions and more.    
 * **Predicate* perdicates are the connection between the nodes (entities) of the graph. You    
 
 # Usage
 ## Installation
 npm i semantix
 ## Preparations
 Basically. you need to:
 1. Have a *store* implementation, or use to provided `MongoStore` and connect to it
 1. Define your ontology
 