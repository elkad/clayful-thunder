const set = require('lodash.set');
const productCatalog = require('./lib/productCatalog.js');

module.exports = Thunder => {

	const implementation = {
		name: 'product-detail'
	};

	implementation.options = () => ({
		product:          '',                                    // Product ID to render
		productActions:   Thunder.options.productActions,        // ['add-to-cart', 'buy-now'],
		optionSelector:   Thunder.options.productOptionSelector, // 'combined' || 'separated'
		descriptionStyle: 'detailed',                            // 'simple' || 'detailed'
		useFollowingNav:  true,                                  // Use following navigation?
		useReviews:       Thunder.options.productReview,         // Use reviews?
		useRating:        (                                      // Use review rating?
			Thunder.options.productReview &&
			Thunder.options.productReviewRating
		),

		onBuyNow: function($container, context, item) {
			return Thunder.render($container, 'cart', { items: [item._id] });
		},
		onItemAdd: function($container, context) {
			return Thunder.notify('success', context.m('itemAddSuccess'));
		},
		onGoToCart: function($container, context) {
			return Thunder.render($container, 'cart');
		}
	});

	implementation.pre = function(context, callback) {

		context.options.productActions = Thunder.util.parseArrayString(context.options.productActions);

		const { product } = context.options;

		context.isUnavailableProduct = product => {

			return (
				// A product is unavailable
				!product.available ||
				(
					product.variants && // While a product has variants array
					(
						// A product doesn't have any variants
						!product.variants.length ||
						// All variants are unavailable
						product.variants.every(v => !v.available)
					)
				) ||
				// A tangible product doesn't support any shipping methods
				(
					product.type === 'tangible' &&
					product.shipping.methods.length === 0
				)
			);

		};

		context.isSoldOutProduct = product => {
			return product.variants.every(v => v.quantity && v.quantity.raw === 0);
		};

		context.isUnavailableVariant = (product, variant) => {

			if (context.isUnavailableProduct(product) ||
				!variant.available) {
				return 'notAvailableVariant';
			}

			if (variant.quantity &&
				variant.quantity.raw === 0) {
				return 'soldOutVariant';
			}

		};

		const errors = {
			'not-existing-product': context.m('notExistingProduct'),
			default:                context.m('productReadFailed')
		};

		return Thunder.request({
			method: 'GET',
			url:    `/v1/products/${product}`,
			query:  {
				embed: '+bundles.items.product.shipping'
			}
		}).then((product, textStatus, jqXHR) => {

			return Thunder.util.getCurrency(jqXHR.getResponseHeader('content-currency')).then(currency => {

				context.currency = currency;
				context.product = moveUnavailablesToEnd(product);

				return callback(null, context);

			});

			function moveUnavailablesToEnd(product) {

				const okVariants = [];
				const notOkVariants = [];

				product.variants.forEach(variant => {
					return context.isUnavailableVariant(product, variant) ?
							notOkVariants.push(variant) :
							okVariants.push(variant)
				});

				product.variants = [].concat(okVariants, notOkVariants);

				product.bundles.forEach(bundle => {

					const okItems = [];
					const notOkItems = [];

					bundle.items.forEach(item => {
						return context.isUnavailableVariant(item.product, item.variant) ?
								notOkItems.push(item) :
								okItems.push(item)
					});

					bundle.items = [].concat(okItems, notOkItems);

				});

				return product;

			}

		}, err => Thunder.util.requestErrorHandler(
			err.responseJSON,
			errors,
			callback
		));

	};

	implementation.bind = function(context) {

		const $container = $(this);
		const $followingNav = $(this).find('.thunder--following-nav-container');

		Thunder.util.followingNavigation($followingNav, context.options.useFollowingNav, [
			{
				name: context.m('productInfo'),
				$el:  $container.find('.thunder--product-detail')
			},
			context.options.useReviews ? {
				name: [
					context.m('productReviews'),
					`<span class="thunder--product-total-comments">(${context.product.totalReview.converted})</span>`,
				].join(' '),
				$el:  $container.find('.thunder--product-reviews-wrapper')
			} : null,
		].filter(v => v));

	};

	implementation.init = function(context) {

		const product = context.product;

		const variantMap = [].concat(
			context.product.variants,
			context.product.bundles.reduce((variants, bundle) => {
				return bundle.items.reduce((variants, item) => {
					return variants.concat(item.variant);
				}, variants);
			}, [])
		).reduce((o, variant) => {
			return set(o, variant._id, variant);
		}, {});

		const bundleProductMap = context.product.bundles.reduce((o, bundle) => {
			return bundle.items.reduce((o, item) => set(o, item.product._id, item.product), o);
		}, {});

		const variantToBundleMap = context.product.bundles.reduce((o, bundle) => {
			return bundle.items.reduce((o, item) => {
				return set(o, item.variant._id, bundle);
			}, o);
		}, {});

		const $container = $(this);
		const $variantSelector = $(this).find('.thunder--product-info .thunder--product-variant-wrap .thunder--product-variant select');
		const $shippingMethodSelector = $(this).find('.thunder--shipping-method select');
		const $itemQuantityInput = $(this).find('.thunder--item-quantity input');
		const $bundleItems = $(this).find('.thunder--product-bundle-item');
		const $bundleItemSelectors = $bundleItems.find('select');
		const $addToCart = $(this).find('.thunder--add-to-cart');
		const $buyNow = $(this).find('.thunder--buy-now');
		const $goToCart = $(this).find('.thunder--go-to-cart');

		const $optionSelect = $(this).find('.thunder--product-option-wrap select');

		const addToCartSpinner = Thunder.util.makeAsyncButton($addToCart);
		const currentOption = context.options.optionSelector;

		productCatalog($container);

		$bundleItemSelectors.on('change', function() {

			const value = $(this).val();
			const $quantity = $(this).closest('.thunder--product-bundle-item').find('input[type="number"]');

			$quantity.val(value ? 1 : 0);

		});

		const calculatePrice = (e) => {
			if (!e.currentTarget) e.currentTarget = e;

			if (e.currentTarget.name === 'shippingMethod') return;

			const variant = $container.find([
				'.thunder--product-option',
				'.thunder--product-variant',
				'select[name="variant"]',
			].join(' '));

			const quantity = $container.find([
				'.thunder--product-option',
				'.thunder--item-quantity',
				'input[name="quantity"]'
			].join(' ')).val();

			const defaultVariant = context.product.variants.length === 1 ?
				context.product.variants[0] :
				null;

			const variantMap = context.product.variants.reduce(function(o, variant) {
				o[variant._id] = variant;
				return o;
			}, {});

			const selectedVariant = variantMap[variant.val()] || defaultVariant;
			const bundleVariantMap = context.product.bundles.reduce(function(items, bundle) {
				return items.concat(bundle.items);
			}, []).reduce(function(o, item) {
				o[item.product._id + '.' + item.variant._id] = item.variant;
				return o;
			}, {});

			if (!selectedVariant) return;

			const itemPrice = selectedVariant.price.sale.raw * quantity;
			const bundlePrice = $container.find('.thunder--product-bundle-item').map(function() {
				const variant = bundleVariantMap[$(this).find('.thunder--product-variant select').val()];
				const quantity = $(this).find('.thunder--item-quantity input[type="number"]').val();

				return variant && quantity ? variant.price.sale.raw * quantity : 0;
			}).get().reduce(function(sum, price) {
					return sum + price;
			}, 0);

			// 최종 금액 (raw)
			const price = itemPrice + bundlePrice;

			if (price) $('.thunder--price-total-wrap').show('on');
			if (!price) $('.thunder--price-total-wrap').hide('on');

			$('.thunder--price-total-value').text(Thunder.util.formatPrice(price, context.currency));
		};

		// 옵션 선택 이벤트 ('separated')
		$optionSelect.on('change', () => {
			const selectItems = [];

			$optionSelect.each((i, v) => {
				selectItems.push($(v).val() ? $(v).val().split('/')[0] : 'none');
			});

			const variantsMap = context.product.variants.reduce((o, v) => {
				o[v.types.map(type => type.variation._id).join('.')] = v.sku;
				return o;
			}, {});
			const target = selectItems.join('.');
			const value = variantsMap[target] || null;

			if (!value && target.indexOf('none') === -1) {
				Thunder.notify('error', context.m('notExistingVariant'));
				$('.thunder--price-total-value').text('');
			}

			if (!value) $('.thunder--price-total-wrap').hide('on');

			$variantSelector.val(value);
			calculatePrice($variantSelector);
		});


		$container.find('input, select').on('change', calculatePrice);

		$addToCart.on('click', () => addToCart());

		$buyNow.on('click', () => addToCart(item => Thunder.execute(
			context.options.onBuyNow,
			$container,
			context,
			item
		)));

		$goToCart.on('click', () => Thunder.execute(
			context.options.onGoToCart,
			$container,
			context
		));

		if (context.options.useReviews) {

			const $reviewsContainer = $(this).find('.thunder--product-reviews-wrapper');

			Thunder.render($reviewsContainer, 'product-reviews', {
				product:       context.product._id,
				productRating: context.options.useRating ?
								product.rating :
								null,
				useRating:     context.options.useRating,
			});

		}

		function clearAllOptions() {
			$('.thunder--price-total-wrap').remove();
			$('.thunder--product-option select').val('');
			$('.thunder--product-option input[type="number"]').val(1);
			$('.thunder--product-bundles select').val('');
			$('.thunder--product-bundles input[type="number"]').val(0);
		}

		function addToCart(success) {
			const item = buildItemData();

			success = success || (() => {

				$goToCart.show();

				Thunder.execute(
					context.options.onItemAdd,
					$container,
					context
				);

			});

			if (!validateItemData(item)) {
				return addToCartSpinner.done();
			}

			const errors = {
				'items-exceeded': context.m('itemsExceeded'),
				default:          context.m('itemAddFailed'),
			};

			if (Thunder.authenticated()) {

				return Thunder.request({
					method: 'POST',
					url:    '/v1/me/cart/items',
					data:   item
				}).then(item => {
					addToCartSpinner.done();
					success(item);
					clearAllOptions(currentOption);
				}, err => Thunder.util.requestErrorHandler(
					err.responseJSON,
					errors,
					err => addToCartSpinner.done()
				));

			} else {

				Thunder.Cart.addItem(item, err => {

					if (err) {
						addToCartSpinner.done();
						return Thunder.notify('error', errors[err.code || 'default'] || errors.default);
					}

					addToCartSpinner.done();
					clearAllOptions(currentOption);
					return success(item);
				});
			}

		}

		function validateItemData(itemData) {
			if (!itemData.variant) {
				Thunder.notify('error', context.m('variantRequired'));
				return false;
			}

			if (!validateQuantity(product.name, itemData)) {
				return false;
			}

			const selectedBundles = [];

			for (const item of itemData.bundleItems || []) {

				const bundle = variantToBundleMap[item.variant];

				selectedBundles.push(bundle);

				if (!validateQuantity(bundle.name, item)) {
					return false;
				}

				if (bundle.required &&
					item.quantity !== itemData.quantity) {
					Thunder.notify('error', context.m('invalidRequiredBundleItemQuantity', { bundle: bundle.name }));
					return false;
				}

			}

			const requiredBundles = product.bundles.filter(b => b.required);

			for (const bundle of requiredBundles) {

				if (selectedBundles.indexOf(bundle) === -1) {
					Thunder.notify('error', context.m('requiredBundleItemRequired', { bundle: bundle.name }));
					return false;
				}

			}

			return true;

			function validateQuantity(scope, item) {
				if (!item.quantity) {
					Thunder.notify('error', context.m('itemQuantityRequired', { scope }));
					return false;
				}

				const variant = variantMap[item.variant];

				if (variant.quantity &&
					variant.quantity.raw < item.quantity) {
					Thunder.notify('error', context.m('exceededItemQuantity', { scope }));
					return false;
				}

				return true;

			}

		}

		function buildItemData() {
			const shippingMethod = $shippingMethodSelector.val();
			const bundleItems = [];

			$bundleItems.each(function() {

				const [product, variant] = ($(this).find('select').val() || '').split('.');

				let bundleItemQuantity = 0;

				bundleItemQuantity = $(this).find('input[type="number"]').val();

				if (!product || !variant) return;

				bundleItems.push({
					product:        product,
					variant:        variant,
					shippingMethod: bundleProductMap[product].type === 'tangible' ?
										shippingMethod :
										null,
					quantity:       bundleItemQuantity ? parseInt(bundleItemQuantity) : null,
				});

			});

			let itemQuantity = $itemQuantityInput.val();
			const variant = $variantSelector.val() ||
								(
									product.variants.length === 1 ?
										product.variants[0]._id :
										null
								) ||
								null;

			return {
				product:        product._id,
				variant:        variant,
				shippingMethod: shippingMethod,
				quantity:       itemQuantity ? parseInt(itemQuantity) : null,
				bundleItems:    bundleItems
			};

		}

	};
	return implementation;

};