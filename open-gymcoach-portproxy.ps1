netsh interface portproxy delete v4tov4 listenaddress=192.168.0.119 listenport=3030
netsh interface portproxy add v4tov4 listenaddress=192.168.0.119 listenport=3030 connectaddress=127.0.0.1 connectport=3030
netsh interface portproxy show v4tov4
