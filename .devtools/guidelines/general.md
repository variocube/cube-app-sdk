# General Guidelines

## Formatting

* Use tabs for indentation.
* Line width: 120 characters.
* UTF-8 encoding.
* LF line endings.
* Trim trailing whitespace.
* End files with a newline.

## Function Parameters

* Keep the number of parameters small (ideally 3 or fewer).
* When a function needs many inputs, use a parameter object instead.
* Examples:
  * `createPayment(paymentCreation)` instead of 10+ individual parameters
  * `updateOrderCustomer(orderId, customerUpdate)` for update operations
  * `searchProducts(searchCriteria)` for complex queries
