

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

    const startTag = /^(?<completeTag>\s*<(?<tagName>\w+[^<]*?)\s*(?:(?<attributes>(?:[^=\s]+="[^"\\]*(?:\\.[^"\\]*)*"\s*)+))?(?<tagEnd>(?:\/)?>))(?<cdata><!\[CDATA\[)?/m;
    // V1: ^(\s*<(\w+[^<]*?)(?:\s([^>\/]*))?(\/>|>))(<!\[CDATA\[)?
    //   issue with '/' characters in attributes
    // V2: ^(\s*<(\w+[^<]*?)(?:\s?((?:[^=\s]+="[^\"]*"\s?)+))?(\/>|>))(<!\[CDATA\[)?
    //   potential issues with escaped characters in attribute values
    // V3: ^(\s*<(\w+[^<]*?)\s*(?:((?:[^=\s]+="[^"\\]*(?:\\.[^"\\]*)*"\s*)+))?((?:\/)?>))(<!\[CDATA\[)?
    //   works

    const endTag = /(?<completeTag><\/(?<tagName>[^>]+)>)$/m;
    const endTagCdata = /]]>(?<completeTag><\/(?<tagName>[^>]+)>)$/m;

    let isCdata = false;

    inStream.pipe(split()).on('data', (line) => {

        const openTag = isCdata ? false : startTag.exec(line);
        if (openTag) {


            isCdata = Boolean(openTag.groups.cdata);

            const tagName = openTag.groups.tagName;
            const selfClosing = (openTag.groups.tagEnd == '/>');
            const attributes = (() => {
                if (!openTag.groups.attributes)
                    return undefined;
                const regex = /\s*([^=]+)="([^"]*)"/g;
                const attributes = {};
                let m;
                while ((m = regex.exec(openTag.groups.attributes)) !== null) {
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
            const text = line.substring(openTag.groups.completeTag.length, line.length - closeTag.groups.completeTag.length)
            onText(text);
        } else if (openTag) {
            const text = line.substring(openTag.groups.completeTag.length).concat('\n');
            onText(text);
        } else if (closeTag) {
            const text = line.substring(line.length - closeTag.groups.completeTag.length, 0);
            onText(text);
        } else {
            onText(line.concat('\n'));
        }

        if (closeTag) {
            onCloseTag(closeTag.groups.tagName)
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
