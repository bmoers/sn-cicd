/* eslint-disable no-useless-escape */
require('dotenv').config();
const Promise = require('bluebird');

const etparse = require('elementtree').parse;

let payload = `
<?xml version="1.0" encoding="UTF-8"?><record_update table="sys_atf_test_suite_test">
<sys_atf_test_suite_test action="INSERT_OR_UPDATE">
<char>\r\nbla\r</char>
<charCdata><![CDATA[ <p>&nbsp;</p> <hr /> <p>&nbsp;</p> ]]></charCdata>
<abort_on_failure /><order attr="value " /><sys_class_name>sys_atf_test_suite_test</sys_class_name></sys_atf_test_suite_test></record_update>
`;
payload = `
&lt;?xml version="1.0" encoding="UTF-8"?&gt;&lt;record_update sys_domain="global" table="sysevent_email_action"&gt;&lt;sysevent_email_action action="INSERT_OR_UPDATE"&gt;&lt;action_insert&gt;false&lt;/action_insert&gt;&lt;action_update&gt;false&lt;/action_update&gt;&lt;active&gt;true&lt;/active&gt;&lt;advanced_condition/&gt;&lt;affected_field_on_event/&gt;&lt;category display_value="IT Service Management" name="IT Service Management"&gt;b69d02137f232200ee2e108c3ffa9142&lt;/category&gt;&lt;collection&gt;change_request&lt;/collection&gt;&lt;condition/&gt;&lt;content_type&gt;text/html&lt;/content_type&gt;&lt;default_interval/&gt;&lt;description/&gt;&lt;digest_from/&gt;&lt;digest_html/&gt;&lt;digest_reply_to/&gt;&lt;digest_separator_html&gt;&lt;![CDATA[&lt;p&gt;&amp;nbsp;&lt;/p&gt;
    &lt;hr /&gt;
    &lt;p&gt;&amp;nbsp;&lt;/p&gt;]]&gt;&lt;/digest_separator_html&gt;&lt;digest_separator_text&gt;&lt;![CDATA[\n--------------------------------------------------------------------------------\n]]&gt;&lt;/digest_separator_text&gt;&lt;digest_subject/&gt;&lt;digest_template/&gt;&lt;digest_text/&gt;&lt;digestable&gt;false&lt;/digestable&gt;&lt;event_name&gt;sr.change.lcm.review&lt;/event_name&gt;&lt;event_parm_1&gt;true&lt;/event_parm_1&gt;&lt;event_parm_2&gt;true&lt;/event_parm_2&gt;&lt;exclude_delegates&gt;false&lt;/exclude_delegates&gt;&lt;force_delivery&gt;false&lt;/force_delivery&gt;&lt;from/&gt;&lt;generation_type&gt;event&lt;/generation_type&gt;&lt;importance/&gt;&lt;include_attachments&gt;false&lt;/include_attachments&gt;&lt;item&gt;event.parm1&lt;/item&gt;&lt;item_table/&gt;&lt;mandatory&gt;false&lt;/mandatory&gt;&lt;message/&gt;&lt;message_html&gt;&lt;![CDATA[&lt;p&gt;Dear Change Manager,&lt;br /&gt;&lt;br /&gt;Your Change $\{URI_REF} for Configuration Item $\{cmdb_ci} is overdue.&lt;br /&gt;&lt;br /&gt;Click the $\{URI} to update and close the Change request.&lt;br /&gt;&lt;br /&gt;Change Request:&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp; $\{URI_REF}&lt;br /&gt; Planned End Time:&amp;nbsp; $\{end_date}&lt;br /&gt; Configuration Item: $\{cmdb_ci}&lt;br /&gt; State:&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp; &amp;nbsp; &amp;nbsp;&amp;nbsp; $\{state}&lt;br /&gt; Priority:&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp; &amp;nbsp; &amp;nbsp; &amp;nbsp; &amp;nbsp; &amp;nbsp;&amp;nbsp;&amp;nbsp; $\{priority}&lt;br /&gt; Requested by: &amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp; &amp;nbsp; $\{requested_by}&lt;br /&gt; Short Description: &amp;nbsp; $\{short_description}&lt;br /&gt; Description:&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp;&amp;nbsp; $\{description}&lt;/p&gt;]]&gt;&lt;/message_html&gt;&lt;message_list/&gt;&lt;message_text/&gt;&lt;name&gt;SR- Life cycle management Review&lt;/name&gt;&lt;omit_watermark&gt;false&lt;/omit_watermark&gt;&lt;order&gt;100&lt;/order&gt;&lt;push_message_only&gt;false&lt;/push_message_only&gt;&lt;recipient_fields/&gt;&lt;recipient_groups/&gt;&lt;recipient_users/&gt;&lt;reply_to/&gt;&lt;send_self&gt;true&lt;/send_self&gt;&lt;sms_alternate/&gt;&lt;style/&gt;&lt;subject&gt;Change Request $\{number} is Overdue&lt;/subject&gt;&lt;subscribable&gt;false&lt;/subscribable&gt;&lt;sys_class_name&gt;sysevent_email_action&lt;/sys_class_name&gt;&lt;sys_created_by&gt;S4GRV8&lt;/sys_created_by&gt;&lt;sys_created_on&gt;2019-08-26 07:39:01&lt;/sys_created_on&gt;&lt;sys_domain&gt;global&lt;/sys_domain&gt;&lt;sys_domain_path&gt;/&lt;/sys_domain_path&gt;&lt;sys_id&gt;492d39bcdb6b3b4825975858dc9619cb&lt;/sys_id&gt;&lt;sys_mod_count&gt;4&lt;/sys_mod_count&gt;&lt;sys_name&gt;SR- Life cycle management Review&lt;/sys_name&gt;&lt;sys_overrides/&gt;&lt;sys_package display_value="SR Change Management" source="b621e5e2dbc12b007193f7b31d961906"&gt;b621e5e2dbc12b007193f7b31d961906&lt;/sys_package&gt;&lt;sys_policy/&gt;&lt;sys_scope display_value="SR Change Management"&gt;b621e5e2dbc12b007193f7b31d961906&lt;/sys_scope&gt;&lt;sys_update_name&gt;sysevent_email_action_492d39bcdb6b3b4825975858dc9619cb&lt;/sys_update_name&gt;&lt;sys_updated_by&gt;S4GRV8&lt;/sys_updated_by&gt;&lt;sys_updated_on&gt;2019-08-30 12:35:41&lt;/sys_updated_on&gt;&lt;sys_version&gt;2&lt;/sys_version&gt;&lt;template display_value="Unsubscribe and Preferences"&gt;7ed0481f3b0b2200c869c2c703efc487&lt;/template&gt;&lt;type&gt;email&lt;/type&gt;&lt;weight&gt;0&lt;/weight&gt;&lt;/sysevent_email_action&gt;&lt;/record_update&gt;
`;
payload = '<?xml version="1.0" encoding="UTF-8"?><record_update sys_domain="global" table="sysevent_email_action"><sysevent_email_action action="INSERT_OR_UPDATE"><action_insert>false</action_insert><action_update>false</action_update><active>true</active><advanced_condition/><affected_field_on_event/><category display_value="IT Service Management" name="IT Service Management">b69d02137f232200ee2e108c3ffa9142</category><collection>change_request</collection><condition/><content_type>text/html</content_type><default_interval/><description/><digest_from/><digest_html/><digest_reply_to/><digest_separator_html><![CDATA[<p>&nbsp;</p>\n<hr />\n<p>&nbsp;</p>]]></digest_separator_html><digest_separator_text><![CDATA[\\n--------------------------------------------------------------------------------\\n]]></digest_separator_text><digest_subject/><digest_template/><digest_text/><digestable>false</digestable><event_name>sr.change.lcm.review</event_name><event_parm_1>true</event_parm_1><event_parm_2>true</event_parm_2><exclude_delegates>false</exclude_delegates><force_delivery>false</force_delivery><from/><generation_type>event</generation_type><importance/><include_attachments>false</include_attachments><item>event.parm1</item><item_table/><mandatory>false</mandatory><message/><message_html><![CDATA[<p>Dear Change Manager,<br /><br />Your Change $\{URI_REF} for Configuration Item $\{cmdb_ci} is overdue.<br /><br />Click the $\{URI} to update and close the Change request.<br /><br />Change Request:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; $\{URI_REF}<br /> Planned End Time:&nbsp; $\{end_date}<br /> Configuration Item: $\{cmdb_ci}<br /> State:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; &nbsp; &nbsp;&nbsp; $\{state}<br /> Priority:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp;&nbsp; $\{priority}<br /> Requested by: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; &nbsp; $\{requested_by}<br /> Short Description: &nbsp; $\{short_description}<br /> Description:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; $\{description}</p>]]></message_html><message_list/><message_text/><name>SR- Life cycle management Review</name><omit_watermark>false</omit_watermark><order>100</order><push_message_only>false</push_message_only><recipient_fields/><recipient_groups/><recipient_users/><reply_to/><send_self>true</send_self><sms_alternate/><style/><subject>Change Request $\{number} is Overdue</subject><subscribable>false</subscribable><sys_class_name>sysevent_email_action</sys_class_name><sys_created_by>S4GRV8</sys_created_by><sys_created_on>2019-08-26 07:39:01</sys_created_on><sys_domain>global</sys_domain><sys_domain_path>/</sys_domain_path><sys_id>492d39bcdb6b3b4825975858dc9619cb</sys_id><sys_mod_count>4</sys_mod_count><sys_name>SR- Life cycle management Review</sys_name><sys_overrides/><sys_package display_value="SR Change Management" source="b621e5e2dbc12b007193f7b31d961906">b621e5e2dbc12b007193f7b31d961906</sys_package><sys_policy/><sys_scope display_value="SR Change Management">b621e5e2dbc12b007193f7b31d961906</sys_scope><sys_update_name>sysevent_email_action_492d39bcdb6b3b4825975858dc9619cb</sys_update_name><sys_updated_by>S4GRV8</sys_updated_by><sys_updated_on>2019-08-30 12:35:41</sys_updated_on><sys_version>2</sys_version><template display_value="Unsubscribe and Preferences">7ed0481f3b0b2200c869c2c703efc487</template><type>email</type><weight>0</weight></sysevent_email_action></record_update>';
//payload = payload.replace(/<([^\/>]*)\/>/g, `<$1 xsi:nil="true"/>`).replace(/<([^\s\/>]*)[^>]*><\/(\1)>/g, `<$1 xsi:nil="true"/>`);


const SnClient = require('../lib/snClient');


const client = new SnClient({
    hostName: 'https://swissreesmdev.service-now.com/',
    proxy: process.env.PROXY_HTTPS_PROXY,

    username: process.env.CICD_CD_USER_NAME,
    password: process.env.CICD_CD_USER_PASSWORD,

    appPrefix: process.env.CICD_APP_PREFIX || undefined,

    debug: false,
    silent: true,
    jar: true
});
client.getUpdateSetFiles('bf534f7fdb9bf34825975858dc9619d8', (results) => {

    return Promise.each(results, (result) => {
        if (result.sys_id == 'c86f3d30dbab3b4825975858dc9619ba') {
            //console.log(result.payload)

            var payload = result.payload;

            //console.log(payload);
            return Promise.try(() => { // parse the XML payload
                return etparse(payload);
            }).then((xmlTree) => { // find all tables, action and sysId in the payload
                return Promise.each(xmlTree.findall('.//*[@action]'), (element) => {
                    /*console.log(element.find('abort_on_failure'))
                    console.log(element.find('order'))
                    console.log(element.find('char'))
                    console.log(element.find('charCdata'))
                    */
                    const text = element.find('digest_separator_html').text;
                    console.log(JSON.stringify(text));
                });

            });


        }
    });

});
