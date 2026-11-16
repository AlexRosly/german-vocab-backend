#!/usr/bin/env node
// Local operator CLI only. No Prisma/Nest application bootstrap and no public send endpoint.
async function main(argv = process.argv.slice(2), env = process.env, load = () => ({
  ...require('../dist/mail/mail-config'), ...require('../dist/mail/mail.service'), ...require('../dist/mail/mail-error'),
})) {
  if (argv.length !== 1 || !['--check-config','--verify','--send-test'].includes(argv[0])) throw Error('mail_usage: --check-config | --verify | --send-test');
  const {readMailConfig,createMailGateway,MailService} = load();
  const config = readMailConfig(env);
  if (argv[0] === '--check-config') return {event:'wortkarten_mail',enabled:config.enabled,configurationValid:true,network:false,sent:false};
  const service = new MailService(createMailGateway(env));
  try {
    await service.verify();
    if (argv[0] === '--send-test') await service.sendSelfTest();
    return {event:'wortkarten_mail',smtpVerified:true,sent:argv[0] === '--send-test',recipient:argv[0] === '--send-test' ? 'sender_mailbox_only' : undefined};
  } finally {service.onModuleDestroy();}
}
function errorCode(error) {
  const allowed=['mail_disabled','mail_configuration_invalid','mail_message_invalid','mail_authentication_failed','mail_connection_failed','mail_delivery_failed'];
  if(allowed.includes(error?.code))return error.code;
  if(error?.code==='MODULE_NOT_FOUND')return 'mail_build_required';
  if(error?.message==='mail_usage: --check-config | --verify | --send-test')return error.message;
  return 'mail_check_failed';
}
module.exports={main,errorCode};
if(require.main===module)main().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({event:'wortkarten_mail',ok:false,code:errorCode(error)}));process.exitCode=1});
