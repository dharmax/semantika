# Semantix
A very friendly semantic-graph database base layer.

## General
It lets you connect entities with named predicates, for example:
 
 `George[:Person] ----worksFor[position:CTO]---> Hooli[:Company]`
 
 ...And easily query the graph.
 
 It also add an ontology, by which such predicates (=relations) and entity types could be defined
 as well as rules. It makes building even complex models very easy and readable.
 
 You can still work with the data as tables and documents when it suits you, or even 
 have collections that are "normal".
 
 Basically, it is agnostic to the underlying database engine but current it uses MongoDB.
 
 ## Status
 This library was already used in several projects and it is in the process of revising as a standalone npm package.      
 
 