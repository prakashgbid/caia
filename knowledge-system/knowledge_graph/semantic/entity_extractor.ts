
import * as natural from 'natural';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

export class EntityExtractor {
  private tokenizer: any;
  private tagger: any;

  constructor() {
    this.tokenizer = new natural.WordTokenizer();
    this.tagger = new natural.BrillPOSTagger();
  }

  extractEntities(text: string) {
    const tokens = this.tokenizer.tokenize(text);
    const tagged = this.tagger.tag(tokens);

    const entities = tagged
      .filter((tag: any) => ['NNP', 'NNPS'].includes(tag[1]))
      .map((tag: any) => ({
        text: tag[0],
        type: 'ENTITY',
        confidence: 0.8
      }));

    return entities;
  }

  extractCodeEntities(code: string) {
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx']
    });

    const entities = {
      functions: [],
      classes: [],
      variables: [],
      imports: []
    };

    traverse(ast, {
      FunctionDeclaration(path: any) {
        entities.functions.push({
          name: path.node.id.name,
          params: path.node.params.map((p: any) => p.name),
          loc: path.node.loc
        });
      },
      ClassDeclaration(path: any) {
        entities.classes.push({
          name: path.node.id.name,
          methods: [],
          loc: path.node.loc
        });
      },
      VariableDeclaration(path: any) {
        path.node.declarations.forEach((decl: any) => {
          if (decl.id.name) {
            entities.variables.push({
              name: decl.id.name,
              kind: path.node.kind,
              loc: decl.loc
            });
          }
        });
      },
      ImportDeclaration(path: any) {
        entities.imports.push({
          source: path.node.source.value,
          specifiers: path.node.specifiers.map((s: any) => s.local.name),
          loc: path.node.loc
        });
      }
    });

    return entities;
  }
}
