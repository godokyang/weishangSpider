const request = require('request');
const fs = require('fs');
const http = require('http')
const cheerio = require('cheerio')
const mime = require('mime')
const url = require('url')
const querystring = require('querystring');
const util = require('util');
const iconv = require('iconv-lite')
const qs = require('qs')
const path = require('path')

const requestList = new Map([
  ['loginUrl', 'https://www.szwego.com/static/index.html?link_type=pc_login'],
  ['operation', 'https://www.szwego.com/service/mp/pc_login_operation.jsp?act=get_param&_='],
  ['qrcode', 'https://open.weixin.qq.com/connect/qrconnect?'],
  ['loginQrDNS', 'https://open.weixin.qq.com'],
  ['checkLogin', 'https://lp.open.weixin.qq.com/connect/l/qrconnect?'],
  ['tokenDns', 'https://www.szwego.com/service/mp/pc_login_auth.jsp?'],
  ['shop', 'https://www.szwego.com/service/album/get_album_themes_list.jsp?act=owner&search_value=&search_img=&start_date=&end_date=']
])

let dns = 'http://localhost'
let port = 7000
let log_goods_id = 'I201908130000538030031868'
let log_path = 'error.log'

//=>公共方法
let responseResult = function responseResult(res, returnVal) {
  res.writeHead(200, {
    'content-type': 'application/json;charset=utf-8;'
  });
  res.end(JSON.stringify(returnVal));
};

let baseHandle = function (req, res) {
  let { method, headers: requestHeaders, data } = req,
    { pathname, query } = url.parse(req.url, true),
    pathREG = /\.([a-z0-9]+)$/i;

  // 静态资源获取
  if (pathREG.test(pathname)) {
    try {
      let result = fs.readFileSync(`./static${pathname}`)
      // 读取成功：根据请求资源文件的类型，设置响应内容的MIME
      let suffix = pathREG.exec(pathname)[1];
      res.writeHead(200, {
        'content-type': `${mime.getType(suffix)};charset=utf-8;`
      });
      res.end(result);

    } catch (error) {
      // 读取失败
      res.writeHead(404, { 'content-type': 'text/plain;charset=utf-8;' });
      res.end('NOT FOUND!');
    }
    return
  }

  // API 接口处理
  if (pathname === '/scanLogin' && method == 'GET') {
    // 模拟微信扫码
    let operationUrl = requestList.get('operation') + '_=' + new Date().getTime()
    promiseRequest(operationUrl)
      .then(r => {
        let bodyObj = JSON.parse(r.body)
        let qrcodePath = `${requestList.get('qrcode')}appid=${bodyObj.result.appid}&redirect_uri=${bodyObj.result.redirect_uri}&state=${bodyObj.result.state}&scope=snsapi_login&login_type=jssdk&self_redirect=default&styletype=&sizetype=&bgcolor=&rst=&style=white`
        return promiseRequest(qrcodePath)
      })
      .then(p => {
        let $ = cheerio.load(p.body, {
          normalizeWhitespace: true,
          decodeEntities: false
        });
        let qrcodePath = $('.wrp_code > img')[0].attribs.src
        console.log('微信二维码:', qrcodePath);
        let uuid = qrcodePath.split('/').pop()
        let imgNode = `<img style="width: 100%;height:100%;margin: auto;" src="${requestList.get('loginQrDNS')}${qrcodePath}">`
        let html = buildHtml(imgNode, uuid);
        res.end(html);
      })
      .catch(err => {
        logError(log_path, 'getQrcode error', err)
        responseResult(res, `网页出问题了,赶紧叫地瓜: ${JSON.stringify(err)}`)
      })
  }

  if (pathname === '/scanComplate' && method == 'POST') {
    var post = '';
    //// 通过req的data事件监听函数，每当接受到请求体的数据，就累加到body变量中
    req.on('data', function (data) {
      post += data.toString()
      // 接收由网页端传回的微商auth API地址
      let setTokenUrl = decodeURIComponent(post.split('=').pop())
      setToken(setTokenUrl)
    });

    req.on('end', function () {
      responseResult(res, `扫描成功: ${JSON.stringify(query)}`)
    });
  }
}

function setToken(setTokenUrl) {
  let options = {
    url: setTokenUrl,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36'
    },
    followRedirect: false,
    followAllRedirects: false
  }
  promiseRequest(options)
    .then(r => {
      let cookieWidthToken = ''
      let shopId = ''
      r.headers.location.split('&').map(item => {
        if (item.indexOf('shop_id') !== -1) {
          shopId = item.split('=').pop()
        }
      })
      r.headers['set-cookie'].map((item) => {
        if (item.indexOf('token') !== -1) {
          cookieWidthToken = item
        }
      })

      let shopUrl = `${requestList.get('shop')}&shop_id=${shopId}&_=${new Date().getTime()}`
      return getAllMissingData(shopUrl, 1, cookieWidthToken)
    })
    .catch(lerr => {
      logError(log_path, 'getData at last step error', lerr)
    })
}

function buildHtml(req, uuid, state) {
  // 组装扫描二维码的html静态文件
  let html = fs.readFileSync('fakeLogin.html', 'UTF-8')
  let $ = cheerio.load(html, {
    normalizeWhitespace: true,
    decodeEntities: false
  })
  $('.img-view').attr('data-uuid', uuid)
  $('.img-view').attr('data-dns', `${dns}:${port}/scanComplate`)
  $('.img-view').attr('data-state', state)
  $('.img-view').append(req)
  return $.root().html()
};

function getAllMissingData(shopUrl, pageIndex, cookieWidthToken) {
  let target = {
    url: `${shopUrl}&page_index=${pageIndex}`,
    headers: {
      cookie: cookieWidthToken
    }
  }
  function getRunningFlag(r) {
    let body = JSON.parse(r.body)
    let spiderFlag = body.result.goods_list.some(item => {
      return item.goods_id === log_goods_id
    })
    fs.writeFile(`output_${pageIndex}.json`, JSON.stringify(body))
    return !spiderFlag && body.result.goods_list.length > 0
  }
  return promiseRequest(target, 1000)
    .then(r => {
      if (getRunningFlag(r)) {
        return getAllMissingData(shopUrl, ++pageIndex, cookieWidthToken)
      } else {
        console.log('data has real saved!!!')
      }
    })
    .catch(err => {
      logError(log_path, 'get goods error', err)
    })
}

function promiseRequest(reqParams, timeout = 100) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      request(reqParams, function (error, response, body) {
        if (error || (response.statusCode !== 200 && response.statusCode !== 302)) {
          reject({
            error: error,
            response: response
          })
          return
        }
        resolve(response)
      })
    }, timeout);
  });
}

function logError(path, title, log) {
  fs.appendFile(path, `${title}: Date: ${new Date()}`)
  fs.appendFile(path, '\r\n')
  fs.appendFile(path, log)
  fs.appendFile(path, '\r\n')
  fs.appendFile(path, '\r\n')
}

http.createServer(baseHandle).listen(port)