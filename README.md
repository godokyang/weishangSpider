# weishangSpider
Nodejs微商相册爬虫-扫码登录
运行步骤
```
1. npm install
2. node index.js
3. 打开浏览器访问localhost:7000/scanLogin
4. 扫码登录后项目文件中出现的output_*.json就是抓下来的数据
```
爬取逻辑
```
1. ***pc_login_operation.jsp?act=get_param 返回appid、redirect_uri、state
2. 根据拿到的appid、redirect_uri、state获取微信授权二维码并返回给浏览器
3. 扫码登录，微信的***/connect/l/qrconnect接口，长轮询，405代表已扫码。成功则返回wxcode
4. 用得到的code调用登录api：***/service/mp/pc_login_auth.jsp。根据抓包得到的逻辑，首先会访问pc_login_auth的80端口然后301重定向到https:443接口，最后302重定向到登录页面并且在cookie中返回登录的access_token。所以在这一步的时候要抓取https:443的那个接口并且不允许重定向，得到返回值以后把access_token保存下来
5. 已经得到access_token后面的数据就都可以拿到了
```
PS：登录之后随便找了一个接口拿数据看了下结果
