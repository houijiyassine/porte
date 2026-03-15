async function getDeviceLogs(token) {
  const t = Date.now().toString();
  const endTime = Date.now();
  const startTime = endTime - 2 * 60 * 1000;
  const query = 'type=1&start_time=' + startTime + '&end_time=' + endTime;
  const path = '/v1.0/devices/' + DEVICE_ID + '/logs';
  const fullPath = path + '?' + query;
  
  const contentHash = crypto.createHash('sha256').update('').digest('hex');
  const stringToSign = 'GET' + '\n' + contentHash + '\n' + '' + '\n' + fullPath;
  const signStr = CLIENT_ID + token + t + stringToSign;
  const sign = crypto.createHmac('sha256', SECRET).update(signStr).digest('hex').toUpperCase();

  const res = await fetch(BASE_URL + fullPath, {
    headers: {
      client_id: CLIENT_ID,
      access_token: token,
      sign: sign,
      t: t,
      sign_method: 'HMAC-SHA256',
    }
  });
  return res.json();
}
