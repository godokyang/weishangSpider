const request = require('request');
const fs = require('fs');
const http = require('http')
const cheerio = require('cheerio')
const mime = require('mime')
const url = require('url')
const mysql = require('mysql');
const iv = require('iconv-lite')
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
  ['shop', 'https://www.szwego.com/service/album/get_album_themes_list.jsp?act=owner&search_value=&search_img=&start_date=&end_date='],
  ['shopOwner', 'https://www.szwego.com/service/album/get_album_list.jsp?act=attention&search_value=&tag_id=&_=']
])

//实现本地链接
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '!qaz2wsx',
  database: 'ChenAnDB'
})

let dns = 'http://localhost'
let port = 7000
let log_goods_id = null
try {
  log_goods_id = fs.readFileSync('log_goods_id')
} catch (error) {
  console.log('====================================');
  console.log(error);
}
let log_path = 'error.log'
let day = -7 // 最多抓取几天的数据

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
      
      let shopOwnerUrl = `${requestList.get('shopOwner')}`
      connection.query('truncate table ChenAnDB_owner_shop;')
      getShopOwner(shopOwnerUrl, 1, cookieWidthToken)
      let shopUrl = `${requestList.get('shop')}&shop_id=${shopId}&_=${new Date().getTime()}`
      getAllMissingData(shopUrl, 1, cookieWidthToken)
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

function getShopOwner(url, pageIndex, cookieWidthToken) {
  let target = {
    url: `${url}&page_index=${pageIndex}`,
    headers: {
      cookie: cookieWidthToken
    }
  }

  promiseRequest(target, 1000)
    .then(r => {
      if (getShopRunningFLag(r)) {
        getShopOwner(url, ++pageIndex, cookieWidthToken)
      } else {
        console.log('owner has real saved!!!')
      }
    })
}

function getShopRunningFLag(r) {
  let list = JSON.parse(r.body).result.shop_list
  if (list.length > 0) {
    writeOwnerToDB(list)
  }
  return list && list.length > 0
}

function getAllMissingData(shopUrl, pageIndex, cookieWidthToken) {
  let target = {
    url: `${shopUrl}&page_index=${pageIndex}`,
    headers: {
      cookie: cookieWidthToken
    }
  }
  
  promiseRequest(target, 1000)
    .then(r => {
      if (getRunningFlag(r)) {
        getAllMissingData(shopUrl, ++pageIndex, cookieWidthToken)
      } else {
        console.log('data has real saved!!!')
      }
    })
    .catch(err => {
      logError(log_path, 'get goods error', err)
    })
}

function getRunningFlag(r) {
  let list = JSON.parse(r.body).result.goods_list
  let rejectTime = new Date().getTime() + 1000*60*60*24*day
  let spiderFlag = list.some(item => {
    return item.goods_id === log_goods_id
  })
  if (!spiderFlag) {
    spiderFlag = list[list.length - 1].time_stamp < rejectTime
  }
  console.log(list[list.length - 1].time_stamp, rejectTime, list[list.length - 1].time_stamp < rejectTime)
  fs.writeFileSync('log_goods_id', list[list.length - 1].goods_id)
  if (list.length > 0) {
    writeProToDB(list)
  }
  
  return !spiderFlag && list.length > 0
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
  fs.exists(path, function (exists) {
    if (exists) {
      fs.appendFileSync(path, `${title}: Date: ${new Date()}`)
      fs.appendFileSync(path, '\r\n')
      fs.appendFileSync(path, log)
      fs.appendFileSync(path, '\r\n')
      fs.appendFileSync(path, '\r\n')
    } else {
      fs.writeFileSync(path, `${title}: Date: ${new Date()}\r\n\r\n${log}\r\n\r\n`)
    }
  })

}

function writeProToDB(list) {
  let sql = list.reduce((result, item, index,arr) => {
    return `${result}("${iv.encode(iGetInnerText(item.title), 'utf8')}","${item.videoURL || item.videoUrl}","${item.imgsSrc.toString()}","${item.goods_id}",${item.time_stamp},"${item.shop_id}")${index===(arr.length - 1) ? ';' : ','}`
  }, 'INSERT INTO ChenAnDB_goods (goods_name, video,images,owner_goods_id,owner_server_time,owner_shop_id) VALUES')
  connection.query(sql, function (error, results, fields) {
    logError(log_path, 'Save Data result:', `${new Date()}${error}\r\n${results}`)
  })
}

function writeOwnerToDB(list, source = "微商相册", shop_status = 0) {
  let sql = list.reduce((result, item, index,arr) => {
    return `${result}("${item.shop_id}","${item.shop_name}","${source}","${item.user_icon}","${"安安的账号"}","${item.shop_url}","${item.total_goods}","${item.new_goods}","${item.followStatus}")${index===(arr.length - 1) ? ';' : ','}`
  }, 'INSERT INTO ChenAnDB_owner_shop (shop_id, shop_name,source,shop_icon,under_account,shop_url,goods_count,new_goods_count,shop_status) VALUES')
  connection.query(sql, function (error, results, fields) {
    logError(log_path, 'Save Data result:', `${new Date()}${error}\r\n${results}`)
  })
}

function iGetInnerText(testStr) {
  let regStr = /[\uD83C|\uD83D|\uD83E][\uDC00-\uDFFF][\u200D|\uFE0F]|[\uD83C|\uD83D|\uD83E][\uDC00-\uDFFF]|[0-9|*|#]\uFE0F\u20E3|[0-9|#]\u20E3|[\u203C-\u3299]\uFE0F\u200D|[\u203C-\u3299]\uFE0F|[\u2122-\u2B55]|\u303D|[\A9|\AE]\u3030|\uA9|\uAE|\u3030/ig;
  let resultStr = testStr.replace(/[\r\n]/g, ""); //去掉空格
  resultStr = resultStr.replace(regStr, "")
  return resultStr;
}

http.createServer(baseHandle).listen(port)