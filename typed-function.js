/**
 * typed-function
 *
 * Type checking for JavaScript functions
 *
 * https://github.com/josdejong/typed-function
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define([], factory);
  } else if (typeof exports === 'object') {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory();
  } else {
    // Browser globals (root is window)
    root.typed = factory();
  }
}(this, function () {
  'use strict';

  // order types
  // anytype (*) will be ordered last, and then object, as other types may be
  // an object too.
  function compareTypes(a, b) {
    if (a === '*') return 1;
    if (b === '*') return -1;

    if (a === 'Object') return 1;
    if (b === 'Object') return -1;

    return 0;
  }

  /**
   * Get a type test function for a specific data type
   * @param {string} type                   A data type like 'number' or 'string'
   * @returns {function(obj: *) : boolean}  Returns a type testing function.
   *                                        Throws an error for an unknown type.
   */
  function getTypeTest(type) {
    var test = typed.types[type];
    if (!test) {
      var matches = Object.keys(typed.types)
          .filter(function (t) {
            return t.toLowerCase() == type.toLowerCase();
          })
          .map(function (t) {
            return '"' + t + '"';
          });

      throw new Error('Unknown type "' + type + '"' +
          (matches.length ? ('. Did you mean ' + matches.join(', or ') + '?') : ''));
    }
    return test;
  }

  // order numbers
  function compareNumbers(a, b) {
    return a > b;
  }

  /**
   * Collection with function definitions (local shortcuts to functions)
   * @constructor
   */
  function Defs() {
    this.categories = {};
  }

  /**
   * Add a function definition.
   * @param {function} fn
   * @param {string} [category='fn']    A function category, like 'fn' or 'signature'
   * @returns {string} Returns the function name, for example 'fn0' or 'signature2'
   */
  Defs.prototype.add = function (fn, category) {
    var cat = category || 'fn';
    if (!this.categories[cat]) this.categories[cat] = [];

    var index = this.categories[cat].indexOf(fn);
    if (index == -1) {
      index = this.categories[cat].length;
      this.categories[cat].push(fn);
    }
    return cat + index;
  };

  /**
   * Create code lines for all definitions
   * @param [name='defs']   Variable name for the array holding the definitions
   * @returns {Array} Returns the code lines containing all function definitions
   */
  Defs.prototype.code = function (name) {
    var code = [];
    name = name || 'defs';

    Object.keys(this.categories).forEach(function (cat) {
      var def = this.categories[cat];
      def.forEach(function (def, index) {
        code.push('var ' + cat + index + ' = ' + name + '[\'' + cat + '\'][' + index + '];');
      });
    }.bind(this));

    return code;
  };

  /**
   * A function parameter
   * @param {string | string[] | Param} types    A parameter type like 'string',
   *                                             'number | boolean'
   * @constructor
   */
  function Param(types) {
    // parse the types, can be a string with types separated by pipe characters |
    if (typeof types === 'string') {
      this.types = types.split('|').map(function (type) {
        return type.trim();
      });
    }
    else if (Array.isArray(types)) {
      this.types = types;
    }
    else if (types instanceof Param) {
      this.types = types.types;
    }
    else {
      throw new Error('String or Array expected');
    }

    // parse varArgs operator (ellipses '...')
    this.varArgs = false;
    this.types.forEach(function (type, index) {
      if (type.substring(type.length - 3) == '...') {
        if (index === this.types.length - 1) {
          this.types[index] = type.substring(0, type.length - 3);
          this.varArgs = true;
        }
        else {
          throw new SyntaxError('Unexpected varArgs "..."');
        }
      }
    }.bind(this));
  }

  /**
   * Return a string representation of this params types, like 'string' or
   * 'number | boolean'
   * @returns {string}
   */
  Param.prototype.toString = function () {
    return this.types.join('|');
  };

  /**
   * A function signature
   * @param {string | string[]} params  Array with the type(s) of each parameter,
   *                                    or a comma separated string with types
   * @param {function} fn               The actual function
   * @constructor
   */
  function Signature(params, fn) {
    if (typeof params === 'string') {
      this.params = (params !== '') ? params.split(',').map(function (types) {
        return new Param(types);
      }) : [];
    }
    else if (Array.isArray(params)) {
      this.params = params.map(function (types) {
        return new Param(types);
      });
    }
    else {
      throw new Error('string or Array expected');
    }
    
    // check varArgs operator '...'
    var withVarArgs = this.params.filter(function (param) {
      return param.varArgs;
    });
    if (withVarArgs.length === 0) {
      this.varArgs = false;
    }
    else if (withVarArgs[0] === this.params[this.params.length - 1]) {
      this.varArgs = true;
    }
    else {
      throw new SyntaxError('Unexpected varArgs "..."');
    }

    this.fn = fn;
  }

  // TODO: implement function Signature.merge
  // TODO: implement function Signature.toString

  /**
   * Split params with multiple types in separate signatures,
   * for example split a Signature "string | number" into two signatures.
   * @return {Signature[]} Returns an array with signatures (at least one)
   */
  Signature.prototype.split = function () {
    var signatures = [];

    function _iterate(signature, types, index) {
      if (index < signature.params.length) {
        var param = signature.params[index];
        param.types.forEach(function (type) {
          _iterate(signature, types.concat(type), index + 1);
        });
      }
      else {
        signatures.push(new Signature(types, signature.fn));
      }
    }
    _iterate(this, [], 0);

    return signatures;
  };

  /**
   * A node is used to create a node tree to recursively traverse parameters
   * of a function. Nodes have either:
   * - Child nodes in a map `types`.
   * - No child nodes but a function `fn`, the function to be called for 
   *   This signature.
   * @param {string[]} [signature]   An optional array with types of the
   *                                 signature up to this child node.
   */ 
  function Node (signature) {
    this.signature = signature || [];
    this.fn = null;
    this.childs = {};
  }

  /**
   * The root node of a node tree is an arguments node, which does not
   * have a map with childs per type, but per argument count
   */ 
  function RootNode() {
    this.args = {};
  }
  
  /**
   * Split all raw signatures into an array with (splitted) Signatures
   * @param {Object.<string, function>} rawSignatures
   * @return {Signature[]} Returns an array with splitted signatures
   */
  function splitSignatures(rawSignatures) {
    return Object.keys(rawSignatures).reduce(function (signatures, params) {
      var fn = rawSignatures[params];
      var signature = new Signature(params, fn);

      return signatures.concat(signature.split());
    }, []);
  }

  /**
   * create a map with normalized signatures as key and the function as value
   * @param {Signature[]} signatures   An array with splitted signatures
   * @return {Object} Returns a map with normalized signatures
   */
  function normalizeSignatures(signatures) {
    var normalized = {};

    signatures.map(function (entry) {
      var signature = entry.params.join(',');
      if (signature in normalized) {
        throw new Error('Error: signature "' + signature + '" defined twice');
      }
      normalized[signature] = entry.fn;
    });

    return normalized;
  }

  /**
   * Create an array with for every parameter an array with possible types
   * @param {Signature[]} signatures   An array with splitted signatures
   * @return {Array.<Array.<string>>} Returns an array with allowed types per parameter
   */
  // TODO: cleanup
  // function splitTypes(signatures) {
  //   var types = [];

  //   signatures.forEach(function (entry) {
  //     entry.params.forEach(function (param, i) {
  //       param.types.forEach(function (type) {
  //         if (!types[i]) {
  //           types[i] = [];
  //         }
  //         if (types[i].indexOf(type) == -1) {
  //           types[i].push(type);
  //         }
  //       });
  //     });
  //   });

  //   return types;
  // }
  
  /**
   * Calculate the maximum number of arguments
   * @param {Signature[]} signatures   An array with splitted signatures
   * @return {number} Returns the maximum number of arguments
   */
  function argumentCount(signatures) {
    var max = 0;

    signatures.forEach(function (signature) {
      var count = signature.params.length;
      if (count > max) {
        max = count;
      }
    });

    return max;
  }
  
  /**
   * Create a recursive node tree for traversing the number and type of parameters
   * @param {Array.<Signature>} signatures   An array with splitted signatures
   * @returns {RootNode} Returns a node tree
   */
  function createNodeTree(signatures) {
    var root = new RootNode();

    signatures.forEach(function (signature) {
      var params = signature.params.concat([]);

      // get the tree entry for the current number of arguments
      var node = root.args[params.length];
      if (!node) {
        node = root.args[params.length] = new Node();
      }

      // loop over all parameters, create a nested structure
      while(params.length > 0) {
        var param = params.shift();
        var type = param.types[0];

        var child = node.childs[type];
        if (child === undefined) {
          child = node.childs[type] = new Node(node.signature.concat(type));
        }
        node = child;
      }

      // add the function as leaf of the innermost node
      node.fn = signature.fn;
    });

    return root;
  }

  /**
   * Compose a function from sub-functions each handling a single type signature.
   * Signatures:
   *   typed(signature: string, fn: function)
   *   typed(name: string, signature: string, fn: function)
   *   typed(signatures: Object.<string, function>)
   *   typed(name: string, signatures: Object.<string, function>)
   *
   * @param {string | null} name
   * @param {Object.<string, function>} signatures
   * @return {function} Returns the typed function
   * @private
   */
  function _typed(name, signatures) {
    var defs = new Defs();

    function switchTypes(node, args, prefix) {
      var code = [];

      if (node.fn !== null) {
        var def = defs.add(node.fn, 'signature');
        code.push(prefix + 'return ' + def + '(' + args.join(', ') +'); // signature: ' + node.signature);
      }
      else {
        // add entries for the provided childs
        Object.keys(node.childs)
            .sort(compareTypes)
            .forEach(function (type, index) {
              var arg = 'arg' + args.length;

              var before;
              var after;
              var nextPrefix = prefix + '  ';
              if (type == '*') {
                before = (index > 0 ? 'else {' : '');
                after  = (index > 0 ? '}' : '');
                if (index === 0) {nextPrefix = prefix;}
              }
              else {
                var def = defs.add(getTypeTest(type), 'test') + '(' + arg + ')';
                before = 'if (' + def + ') { // type: ' + type;
                after  = '}';
              }

              if (before) code.push(prefix + before);
              code = code.concat(switchTypes(node.childs[type], args.concat(arg), nextPrefix));
              if (after) code.push(prefix + after);
            });

        // add entries for type conversions
        var added = {};
        typed.conversions
            .filter(function (conversion) {
              return node.childs[conversion.to] &&
                  !node.childs[conversion.from];
            })
            .forEach(function (conversion) {
              if (!added[conversion.from]) {
                added[conversion.from] = true;

                var arg = 'arg' + args.length;
                var test = defs.add(getTypeTest(conversion.from), 'test') + '(' + arg + ')';
                var convert = defs.add(conversion.convert, 'convert') + '(' + arg + ')';

                code.push(prefix + 'if (' + test + ') { // type: ' + conversion.from + ', convert to ' + conversion.to);
                code = code.concat(switchTypes(node.childs[conversion.to], args.concat(convert), prefix + '  '));
                code.push(prefix + '}');
              }
            });
      }

      return code;
    }

    var structure = splitSignatures(signatures);
    var root = createNodeTree(structure);

    var code = [];
    var argCounts = Object.keys(root.args);
    var count = argumentCount(structure);
    var params = [];
    for (var i = 0; i < count; i++) {
      params[i] = 'arg' + i;
    }
    code.push('return function ' + (name || '') + '(' + params.join(', ') + ') {');
    argCounts
        .sort(compareNumbers)
        .forEach(function (argCount, index) {
          var node = root.args[argCount];
          var args = [];
          var statement = (index === 0) ? 'if' : 'else if';
          code.push('  ' + statement + ' (arguments.length == ' + argCount +  ') {');
          code = code.concat(switchTypes(node, args, '    '));

          code.push('  }');
          if (index == argCounts.length - 1) {
            code.push('  else {');
            code.push('    throw new TypeError(\'Wrong number of arguments\');'); // TODO: output the allowed numbers
            code.push('  }');
          }
        });
    code.push('  throw new TypeError(\'Wrong function signature\');');  // TODO: output the actual signature
    code.push('}');

    var factory = [];
    factory.push('(function (defs) {');
    factory = factory.concat(defs.code('defs'));
    factory = factory.concat(code);
    factory.push('})');

    var fn = eval(factory.join('\n'))(defs.categories);

    // attach the signatures with sub-functions to the constructed function
    fn.signatures = normalizeSignatures(structure); // normalized signatures

    return fn;
  }

  // data type tests
  var types = {
    'null':     function (x) {return x === null},
    'boolean':  function (x) {return typeof x === 'boolean'},
    'number':   function (x) {return typeof x === 'number'},
    'string':   function (x) {return typeof x === 'string'},
    'function': function (x) {return typeof x === 'function'},
    'Array':    function (x) {return Array.isArray(x)},
    'Date':     function (x) {return x instanceof Date},
    'RegExp':   function (x) {return x instanceof RegExp},
    'Object':   function (x) {return typeof x === 'object'}
  };

  // type conversions. Order is important
  var conversions = [];

  // temporary object for holding types and conversions, for constructing
  // the `typed` function itself
  // TODO: find a more elegant solution for this
  var typed = {
    types: types,
    conversions: conversions
  };

  /**
   * Construct the typed function itself with various signatures
   *
   * Signatures:
   *
   *   typed(signature: string, fn: function)
   *   typed(name: string, signature: string, fn: function)
   *   typed(signatures: Object.<string, function>)
   *   typed(name: string, signatures: Object.<string, function>)
   */
  typed = _typed('typed', {
    'Object': function (signatures) {
      return _typed(null, signatures);
    },
    'string, Object': _typed,
    'string, function': function (signature, fn) {
      var signatures = {};
      signatures[signature] = fn;
      return _typed(null, signatures);
    },
    'string, string, function': function(name, signature, fn) {
      var signatures = {};
      signatures[signature] = fn;
      return _typed(name, signatures);
    }
  });

  // attach types and conversions to the final `typed` function
  typed.types = types;
  typed.conversions = conversions;

  return typed;
}));

