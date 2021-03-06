import React from 'react';
import roundTo from 'round-to';
import Button from 'components/Button';
import Input from 'components/Input';
import TabButton from 'components/TabButton';
import appContainer from 'containers/App';
import exchangeContainer from 'containers/Exchange';
import Select from 'components/Select';
import CurrencySelectOption from 'components/CurrencySelectOption';
import { translate } from '../../translate';
import SwapIcon from 'icons/Swap';
import './Atomic.scss';
import ExchangeList from './ExchangeList';

const t = translate('exchange');

class Atomic extends React.Component {
	constructor(props) {
		super(props);
		this.state = {
			sellAmount: '',
			buyAmount: '',
			exchangeRate: '',
			tabType: 'buy',
			buySymbol: "",
			sellSymbol: "",
			selectedCurrency: null,
			isValidSellAmount: true,
		}
	}

	componentDidMount() {
		const {state} = exchangeContainer;
		if (state.baseCurrency && state.quoteCurrency && (state.baseCurrency !== state.quoteCurrency)) {
			const selectedCurrency = this.getSelectedCurrency();
			this.setState({
				selectedCurrency,
				sellSymbol: state.baseCurrency,
				buySymbol: state.quoteCurrency,
				sellAmount: state.exchangeInfo.sellAmount,
				buyAmount: state.exchangeInfo.buyAmount,
				exchangeRate: state.exchangeInfo.exchangeRate,
			});
		}
	}

	setExchangeInfo = () => {
		exchangeContainer.setExchangeInfo({
			sellAmount: this.state.sellAmount,
			buyAmount: this.state.buyAmount,
			exchangeRate: this.state.exchangeRate,
		})
	}

	handleSellAmountChange = value => {
		let balance = this.state.selectedCurrency ? roundTo(this.state.selectedCurrency.balance, 8) : 0;
		if (value !== 0) {
			if (roundTo(Number(value), 8) > balance) {
				this.setState({isValidSellAmount : false});
			} else {
				this.setState({ sellAmount: value, isValidSellAmount: true }, () => {
					this.setState({ buyAmount:  String(roundTo(Number(this.state.sellAmount) * Number(this.state.exchangeRate), 8))}, () => {
						this.setExchangeInfo();
					})
				});
			}
		}
	}

	handleBuyAmountChange = value => {
		this.setState({ buyAmount: value }, () => {
			if (Number(this.state.exchangeRate) > 0) {
				this.setState({sellAmount: String(roundTo(Number(this.state.buyAmount) / Number(this.state.exchangeRate), 8))}, () => {
					this.setExchangeInfo();
				});
			}
		});
	}

	handleRateChange = value => {
		this.setState({ exchangeRate: value }, () => {
			if (this.state.sellAmount !== '') {
				this.setState({ buyAmount:  String(roundTo(Number(this.state.sellAmount) * Number(this.state.exchangeRate), 8))}, () => {
					this.setExchangeInfo();
				})
			}
			else {
				if (Number(this.state.exchangeRate) > 0) {
					this.setState({sellAmount: String(roundTo(Number(this.state.buyAmount) / Number(this.state.exchangeRate), 8))}, () => {
						this.setExchangeInfo();
					});
				}
			}
		});
	}

	handleSelectChange = async (selectedOption, type) => {
		if (type === 'sell') {
			await exchangeContainer.setBaseCurrency(selectedOption.value);
			const selectedCurrency = this.getSelectedCurrency();
			this.setState({selectedCurrency, sellSymbol: selectedOption.value});
		} else {
			exchangeContainer.setQuoteCurrency(selectedOption.value);
			this.setState({buySymbol: selectedOption.value});
		}
	};

	getSelectedCurrency = () => {
		const {state} = exchangeContainer;
		const selectedCurrencySymbol = state.baseCurrency;
		return appContainer.getCurrency(selectedCurrencySymbol);
	};

	changeCurrency = async () => {
		const {sellSymbol, buySymbol} = this.state;
		
		await this.setState({buySymbol: sellSymbol, sellSymbol: buySymbol});
		await exchangeContainer.setBaseCurrency(buySymbol);
		await exchangeContainer.setQuoteCurrency(sellSymbol);
		const selectedCurrency = this.getSelectedCurrency();
		this.setState({ selectedCurrency });
	}

	handleOrder = async () => {
		const {api} = appContainer;
		const {baseCurrency, quoteCurrency} = exchangeContainer.state;
		const price = this.state.exchangeRate;
		const amount = this.state.sellAmount;
		const type = "sell";
		const total = Number(this.state.buyAmount);
		const orderError = error => {
			// eslint-disable-next-line no-new
			new Notification(t('order.failedTrade', {baseCurrency, type}), {body: error});
			exchangeContainer.setIsSendingOrder(false);
			this.setState({hasError: true});
		};

		let requestOpts = {
			type,
			baseCurrency,
			quoteCurrency,
			price: Number(price),
			volume: Number(amount)
		};
		let swap;
		
		if (baseCurrency && quoteCurrency && baseCurrency !== quoteCurrency && this.state.isValidSellAmount && total !== 0) {
			exchangeContainer.setIsSendingOrder(true);
			try {
				swap = await api.order(requestOpts);
			} catch (error) {
				console.log('a', error);
				orderError(error);
				return;
			}

			requestOpts.amount = requestOpts.volume;
			requestOpts.total = total;

			const {swapDB} = appContainer;
			await swapDB.insertSwapData(swap, requestOpts);
			exchangeContainer.setIsSendingOrder(false);
			new Notification(t('order.successOrder'));
		}
	}

	render() {
		const {currencies} = appContainer.state;

		const selectData = currencies.map(currency => ({
			label: `${currency.symbol} ${currency.name}`,
			value: currency.symbol,
		}));
		
		return (
			<div>
				<div className="Atomic">
					<div className="sell-currency">
						<div className="form-group">
							<Input
								className="sell-amount"
								type="text"
								onlyNumeric
								value={this.state.sellAmount}
								onChange={this.handleSellAmountChange}
							/>
							{!this.state.isValidSellAmount && <p className="error_msg">Amount should be less than balance</p> }
						</div>
						<div className="form-group">
							<Select
								className="currency-selector"
								value={this.state.sellSymbol}
								options={selectData}
								valueRenderer={CurrencySelectOption}
								optionRenderer={CurrencySelectOption}
								onChange={option => this.handleSelectChange(option, 'sell')}
							/>
							<h3 className="balance">
								{t('order.symbolBalance')}: <span>{this.state.selectedCurrency ? roundTo(this.state.selectedCurrency.balance, 8) : 0}</span>
							</h3>
						</div>
					</div>
					<div className="swap-currency">
						<button onClick={this.changeCurrency}>
							<SwapIcon />
						</button>
					</div>
					<div className="buy-currency">
						<div className="form-group">
							<Input
								className="buy-amount"
								type="text"
								onlyNumeric
								value={this.state.buyAmount}
								onChange={this.handleBuyAmountChange}
							/>
						</div>
						<div className="form-group">
							<Select
								className="currency-selector"
								value={this.state.buySymbol}
								options={selectData}
								valueRenderer={CurrencySelectOption}
								optionRenderer={CurrencySelectOption}
								onChange={option => this.handleSelectChange(option, 'buy')}
							/>
						</div>
						<div className="form-group">
							<Input
								className="sell-rate"
								type="text"
								placeholder={t('exchange.exchangeRatePlaceholder')}
								onlyNumeric
								value={this.state.exchangeRate}
								onChange={this.handleRateChange}
							/>
						</div>
						<p className="global-rate">{this.state.sellSymbol.toUpperCase()}/{this.state.buySymbol.toUpperCase()} Global market rate: <span>3.215</span></p>
						<p className="global-rate-date">updated 10/11/18, 11:31</p>
						<div className="form-group">
							<Button
								className="exchange-btn"
								fullwidth
								color="blue"
								value={t('exchange.exchangeButton')}
								onClick={this.handleOrder}
								disabled={!this.state.isValidSellAmount || Number(this.state.buyAmount) === 0}
							/>
						</div>
					</div>
				</div>
				<div className="exchange-history">
					<nav>
						<TabButton
							isActive={this.state.tabType === 'buy'}
							onClick={() => this.setState({ tabType: 'buy' })}
						>
							{t('exchange.buyTab')}
						</TabButton>
						<TabButton
							isActive={this.state.tabType === 'sell'}
							onClick={() => this.setState({ tabType: 'sell' })}
						>
							{t('exchange.sellTab')}
						</TabButton>
					</nav>
					<main>
						{this.state.tabType === 'buy' && <ExchangeList type="buy" />}
						{this.state.tabType === 'sell' && <ExchangeList type="sell" />}
					</main>
				</div>
			</div>
		);
	}
}

export default Atomic;
