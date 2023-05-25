import { RWLock } from 'async-rwlock'
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { url } from 'inspector'

interface ITokenInfo {
  token: string
  token_type: string
  expiration: number
}

type IGetTokenResp = ITokenInfo

interface IGetEnvResp {
  id: number
  name: string
  value: string
  remarks: string
}

export class Client {
  baseUrl: string
  clientId: string
  clientSecret: string
  tokenInfo: ITokenInfo | null
  axiosInstance: AxiosInstance

  constructor(baseUrl: string, clientId: string, clientSecret: string) {
    this.baseUrl = baseUrl
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.axiosInstance = axios.create({
      method: 'GET',
      baseURL: this.baseUrl,
      responseType: 'json',
      timeout: 3000,
    })
    this.tokenInfo = null
  }

  async request(config: AxiosRequestConfig) {
    const resp = await this.axiosInstance.request(config)
    if (resp.status < 200 || resp.status >= 300) {
      const respText = resp.data
      throw new Error(`requestFail: url: ${url}, resp: ${respText}`)
    }

    const { code, data } = resp.data
    if (code !== 200) {
      const dataText = JSON.stringify(data)
      throw new Error(
        `requestFail: url: ${url}, code: ${code}, data: ${dataText}`,
      )
    }

    return data
  }

  async doGetToken(): Promise<IGetTokenResp> {
    return this.request({
      method: 'GET',
      url: '/open/auth/token',
      params: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
      },
    })
  }

  async getToken(): Promise<string> {
    let tokenInfo = this.tokenInfo
    if (tokenInfo && tokenInfo.expiration) {
      return `${tokenInfo.token_type} ${tokenInfo.token}`
    }

    const lock = new RWLock()
    try {
      await lock.writeLock()
      tokenInfo = this.tokenInfo
      if (tokenInfo && tokenInfo.expiration) {
        return `${tokenInfo.token_type} ${tokenInfo.token}`
      }

      this.tokenInfo = await this.doGetToken()
      tokenInfo = this.tokenInfo
      return `${tokenInfo.token_type} ${tokenInfo.token}`
    } finally {
      lock.unlock()
    }
  }

  async getEnv(name: string): Promise<IGetEnvResp> {
    const envs: IGetEnvResp[] = await this.request({
      method: 'GET',
      url: '/open/envs',
      headers: {
        Authorization: await this.getToken(),
      },
      params: {
        searchValue: name,
      },
    })

    for (let env of envs) {
      if (env.name === name) {
        return env
      }
    }

    throw new Error(`Env '${name}' Not Found`)
  }

  async setEnv(
    name: string,
    value: string,
    remarks?: string,
  ): Promise<IGetEnvResp> {
    const env = await this.getEnv(name)
    if (!env) {
      throw new Error(`Env '${name}' Not Exist`)
    }

    return this.request({
      method: 'PUT',
      url: '/open/envs',
      headers: {
        Authorization: await this.getToken(),
        'Content-Type': 'application/json',
      },
      data: {
        id: env.id,
        name,
        value,
        remarks,
      },
    })
  }
}
