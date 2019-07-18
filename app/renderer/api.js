/* eslint-disable camelcase */
import util from 'util';
import PQueue from 'p-queue';
import ow from 'ow';
import _ from 'lodash';
import {getCurrency} from '../marketmaker/supported-currencies';
import {isDevelopment} from '../util-common';

const symbolPredicate = ow.string.uppercase;
const uuidPredicate = ow.string.matches(/[a-z\d-]/);
//const smartContractAddress = "0x8500AFc0bc5214728082163326C2FF0C73f4a871"; // Ethereum mainnet
const smartContractAddress = "0x7Bc1bBDD6A0a722fC9bffC49c921B685ECB84b94"; // Ethereum ropsten

const errorWithObject = (message, object) => new Error(`${message}:\n${util.format(object)}`);
const genericError = object => errorWithObject('Encountered an error', object);

export default class Api {
	constructor({endpoint, rpcPassword, concurrency = Infinity}) {
		ow(endpoint, 'endpoint', ow.string);
		ow(rpcPassword, 'rpcPassword', ow.string);
		ow(concurrency, 'concurrency', ow.number.positive.integerOrInfinite);

		this.endpoint = endpoint;
		this.rpcPassword = rpcPassword;
		this.queue = new PQueue({concurrency});
	}

	async request(data) {
		ow(data, 'data', ow.object);

		const body = {
			...data,
			// TODO: When https://github.com/artemii235/SuperNET/issues/298 is fixed, rename `userpass` to `rpc_password` and also reduce the places we pass around `seedPhrase`.
			userpass: this.rpcPassword,
		};

		let result;
		try {
			let requestTime;
			const response = await this.queue.add(() => {
				requestTime = Date.now();

				return fetch(this.endpoint, {
					method: 'post',
					body: JSON.stringify(body)
				});
			});

			result = await response.json();

			if (isDevelopment) {
				// TODO: Use `Intl.RelativeTimeFormat` here when we use an Electron version with Chrome 71
				const requestDuration = (Date.now() - requestTime) / 1000;
				const groupLabel = `API method: ${body.method} (${requestDuration}s)`;
				console.groupCollapsed(groupLabel);
				console.log('Request:', _.omit(body, ['needjson', 'userpass']));
				console.log('Response:', response.status, result);
				console.groupEnd(groupLabel);
			}
		} catch (error) {
			if (error.message === 'Failed to fetch') {
				error.message = 'Could not connect to Marketmaker';
			}

			throw error;
		}

		return result;
	}

	async debug(data) {
		const result = await this.request(data);
		console.log(result);
		return result;
	}

	botList() {
		return this.request({method: 'bot_list'});
	}

	async enableCurrency(symbol) {
		ow(symbol, 'symbol', symbolPredicate);

		const currency = getCurrency(symbol);

		if (!currency) {
			console.error('Tried to enable unsupported currency:', symbol);
			return;
		}

		if (currency.electrumServers) {
			const servers = currency.electrumServers.map(server => ({
				url: `${server.host}:${server.port}`,
				// TODO: Use HTTPS for the Electrum servers that supports it.
				// protocol: 'SSL',
			}));

			const response = await this.request({
				method: 'electrum',
				coin: symbol,
				servers,
				mm2: 1
			});

			const isSuccess = response.result === 'success';
			if (!isSuccess) {
				const error = `Could not connect to ${symbol} Electrum server`;
				console.error(error);
				// eslint-disable-next-line no-new
				new Notification(error);
				return;
			}

			console.log('Enabled Electrum for currency:', symbol);
			return;
		}

		if (currency.urls === undefined)
			currency.urls = [
				'http://eth1.cipig.net:8555',
				'http://eth2.cipig.net:8555',
				'http://eth3.cipig.net:8555',
			];
		const response = await this.request({
			method: 'enable',
			coin: symbol,
			urls: currency.urls,
			swap_contract_address: smartContractAddress,
			gas_station_url: 'https://ethgasstation.info/json/ethgasAPI.json',
			mm2: 1,
		});
		const isSuccess = response.result === 'success';
		if (!isSuccess) {
			const error = `Could not connect to ${symbol} server`;
			console.error(error);
			// eslint-disable-next-line no-new
			new Notification(error);
		}

		console.log('Enabled for currency:', symbol);
		return isSuccess;
	}

	// Mm v2 doesn't currently have an endpoint for disabling a coin, so we do nothing.
	// https://github.com/artemii235/SuperNET/issues/459
	async disableCurrency(/** symbol */) {
		/// ow(symbol, 'symbol', symbolPredicate);

		// return this.request({
		// 	method: 'disable',
		// 	coin: symbol,
		// });
	}

	balance(coin, address) {
		ow(coin, 'coin', symbolPredicate);
		ow(address, 'address', ow.string);

		return this.request({
			method: 'balance',
			coin,
			address,
		});
	}

	coins() {
		return this.request({method: 'getcoins'});
	}

	// Mm v2
	async orderBook(baseCurrency, quoteCurrency) {
		ow(baseCurrency, 'baseCurrency', symbolPredicate);
		ow(quoteCurrency, 'quoteCurrency', symbolPredicate);
		if (!baseCurrency || !quoteCurrency || baseCurrency === quoteCurrency) {
			return null;
		} 
		const response = await this.request({
			method: 'orderbook',
			base: baseCurrency,
			rel: quoteCurrency,
		});
		const formatOrders = orders => orders
			.map(order => ({
				address: order.address,
				depth: order.depth,
				price: order.price,
				averageVolume: order.avevolume,
				maxVolume: order.maxvolume,
				zCredits: order.zcredits,
			}));

		const formattedResponse = {
			baseCurrency: response.base,
			quoteCurrency: response.rel,
			asks: formatOrders(response.asks),
			bids: formatOrders(response.bids),
		};
		return formattedResponse;
	}

	// Mm v2
	async order(opts) {
		ow(opts, 'opts', ow.object.exactShape({
			type: ow.string.oneOf(['buy', 'sell']),
			baseCurrency: symbolPredicate,
			quoteCurrency: symbolPredicate,
			price: ow.number.finite,
			volume: ow.number.finite,
		}));
		
		const { result } = await this.request({
			method: opts.type,
			gtc: 1, // TODO: Looks like this is missing from mm v2
			base: opts.baseCurrency,
			rel: opts.quoteCurrency,
			price: opts.price,
			volume: opts.volume,
		});
		
		result.baseAmount = Number(result.base_amount);
		delete result.base_amount;

		result.quoteAmount = Number(result.rel_amount);
		delete result.rel_amount;

		return result;
	}

	// Mm v2
	async orderStatus(uuid) {
		ow(uuid, 'uuid', uuidPredicate);

		const {result} = await this.request({
			method: 'order_status',
			uuid,
		});

		return result;
	}

	// Mm v2
	async mySwapStatus(uuid) {
		ow(uuid, 'uuid', uuidPredicate);

		const {result} = await this.request({
			method: 'my_swap_status',
			params: {uuid},
		});

		return result;
	}

	// Mm v2
	// https://github.com/artemii235/developer-docs/blob/mm/docs/basic-docs/atomicdex/atomicdex-api.md#my_recent_swaps
	// TODO: Add support for the input arguments it supports.
	async myRecentSwaps() {
		const {result} = await this.request({
			method: 'my_recent_swaps',
		});

		return result.swaps;
	}

	// Mm v2
	// https://github.com/artemii235/developer-docs/blob/mm/docs/basic-docs/atomicdex/atomicdex-api.md#get_enabled_coins
	async getEnabledCurrencies() {
		const {result} = await this.request({
			method: 'get_enabled_coins',
		});

		return result;
	}

	// Mm v2
	// https://github.com/artemii235/developer-docs/blob/mm/docs/basic-docs/atomicdex/atomicdex-api.md#cancel_order
	async cancelOrder(uuid) {
		ow(uuid, 'uuid', uuidPredicate);

		const response = await this.request({
			method: 'cancel_order',
			uuid,
		});

		if (response.error) {
			throw new Error(response.error);
		}
	}

	async getFee(coin) {
		ow(coin, 'coin', symbolPredicate);

		const response = await this.request({
			method: 'getfee',
			coin,
		});

		if (response.result !== 'success') {
			throw genericError(response);
		}

		return response.txfee;
	}

	// Mm v2
	// https://github.com/artemii235/developer-docs/blob/mm/docs/basic-docs/atomicdex/atomicdex-api.md#my_balance
	async myBalance(currency) {
		ow(currency, 'currency', symbolPredicate);

		const response = await this.request({
			method: 'my_balance',
			coin: currency,
		});

		return {
			address: response.address,
			balance: Number(response.balance),
		};
	}

	// Mm v2
	// https://github.com/artemii235/developer-docs/blob/mm/docs/basic-docs/atomicdex/atomicdex-api.md#coins_needed_for_kick_start
	async coinsNeededForKickStart() {
		const {result} = await this.request({
			method: 'coins_needed_for_kick_start',
		});

		return result;
	}

	async _withdraw(opts) {
		ow(opts, 'opts', ow.object.exactShape({
			symbol: symbolPredicate,
			address: ow.string,
			amount: ow.number.positive.finite,
		}));

		console.log("withdraw");
		
		const response = await this.request({
			method: 'withdraw',
			coin: opts.symbol,
			to: opts.address,
			amount: opts.amount,
			broadcast: 0,
		});

		const tx_hex = response.tx_hex;
		const gas_price = response.fee_details.gas_price;
		const gas = response.fee_details.gas;
		const txFee = response.fee_details.amount ? response.fee_details.amount : gas_price * gas;
		
		let hasBroadcast = false;
		const broadcast = async () => {
			if (hasBroadcast) {
				throw new Error('Transaction has already been broadcast');
			}

			hasBroadcast = true;

			const response = await this.request({
				method: 'send_raw_transaction',
				coin: opts.symbol,
				tx_hex,
			});

			if (response.error) {
				throw errorWithObject('Couldn\'t create withdrawal transaction', response);
			}

			return {
				txid: response.tx_hash,
				symbol: opts.symbol,
				amount: opts.amount,
				address: opts.address,
			};
		};

		return {
			txFee,
			broadcast,
		};
	}

	withdraw(opts) {
		ow(opts, 'opts', ow.object.exactShape({
			symbol: symbolPredicate,
			address: ow.string,
			amount: ow.number.positive.finite,
		}));
		return this._withdraw(opts);
	}

	listUnspent(coin, address) {
		ow(coin, 'coin', symbolPredicate);
		ow(address, 'address', ow.string);

		return this.request({
			method: 'listunspent',
			coin,
			address,
		});
	}

	async funds() {
		const coins = (await this.coins()).filter(coin => coin.status === 'active');
		return Promise.all(coins.map(coin => this.balance(coin.coin, coin.smartaddress)));
	}

	ticker() {
		return this.request({method: 'ticker'});
	}

	async stop() {
		this.queue.clear();
		await this.request({method: 'stop'});
		this.queue.pause();
		this.queue.clear();
	}
}
