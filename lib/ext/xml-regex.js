

/*
    Special encodings in payload like
        <payload>&lt;?xml version="1.0" encoding="UTF-8"?&gt;&lt;record_upd
    caused problems in XML -> JS -> XML transformation with 'sax' (internally used in 'xml-flow') or the one used in 'node-xml-stream-parser'.

    As update set XML are separated by newline 'split' can be used instead.

    This is inspired by 'xml-flow'.
    
*/

/* eslint complexity: 0 */
/*eslint func-names: [0] */


const split = require('split');
const { EventEmitter } = require('events');


const xmlRegex = function xmlRegex(inStream) {

    const emitter = new EventEmitter();
    const stack = [];

    let element = null;

    const onOpenTag = (node) => {

        //console.log("open tag", node);

        //Ignore nodes we don't care about.
        if (stack.length === 0 && !emitter.listeners(`tag:${node.name}`).length) {
            return;
        }

        element = {
            $name: node.name,
            $parent: stack.length
        }
        if (node.attributes) {
            element.$attrs = node.attributes;
        }
        stack.push(element);

    }

    const onText = (text) => {
        if (element) {
            if (element.$text) {
                element.$text += text;
            } else {
                element.$text = text;
            }
        }
    }

    const onCloseTag = (tagName) => {


        //If we're not going to send out a node, goodbye!
        if (stack.length === 0) return;

        //console.log("close tag", element)

        //emit the node if there are listeners

        if (emitter.listeners(`tag:${tagName}`).length) {
            emitter.emit(
                `tag:${tagName}`,
                element
            );
        }

        if (element.$parent) {
            const parent = stack[element.$parent - 1];
            if (parent.$markup) {
                parent.$markup.push(element);
            } else {
                parent.$markup = [element];
            }
            //console.log('PARENT', parent);
        }

        //Pop stack, and add to parent node
        stack.pop();

        element = (stack.length) ? stack[stack.length - 1] : null;
    }


    const startTag = /^(\s*<(\w+[^<]*?)(?:\s([^>\/]*))?(\/>|>))(<!\[CDATA\[)?/m; // const startTag = /^<(\w+[^<]*?)(?:\s([^>\/]*))?(\/>|>)(<!\[CDATA\[)?/m;
    const endTag = /(<\/([^>]+)>)$/m;
    const endTagCdata = /]]>(<\/([^>]+)>)$/m;

    let isCdata = false;

    inStream.pipe(split()).on('data', (line) => {

        const openTag = isCdata ? false : startTag.exec(line);
        if (openTag) {

            isCdata = Boolean(openTag[5]);

            const tagName = openTag[2];
            const selfClosing = (openTag[4] == '/>');
            const attributes = (() => {
                const regex = /\s*([^=]+)="([^"]*)"/g;
                const attributes = {};
                let m;
                while ((m = regex.exec(openTag[3])) !== null) {
                    if (m.index === regex.lastIndex) { regex.lastIndex++; }
                    attributes[m[1]] = m[2];
                }
                return Object.keys(attributes).length ? attributes : undefined;
            })();

            const node = {
                name: tagName,
                attributes
            };

            onOpenTag(node);

            if (selfClosing) {
                isCdata = false;
                onCloseTag(tagName)
                return;
            }
        }

        const closeTag = isCdata ? endTagCdata.exec(line) : endTag.exec(line);

        if (openTag && closeTag) {
            const text = line.substring(openTag[1].length, line.length - closeTag[1].length)
            onText(text);
        } else if (openTag) {
            const text = line.substring(openTag[1].length).concat('\n');
            onText(text);
        } else if (closeTag) {
            const text = line.substring(line.length - closeTag[1].length, 0);
            onText(text);
        } else {
            onText(line.concat('\n'));
        }

        if (closeTag) {
            onCloseTag(closeTag[2])
            isCdata = false;
        }

    }).on('end', () => {
        emitter.emit('end');
    }).on('error', (error) => {
        emitter.emit('error', error);
    });

    emitter.pause = function pause() {
        inStream.pause();
    };

    emitter.resume = function resume() {
        inStream.resume();
    };

    return emitter;
};

module.exports = xmlRegex;
