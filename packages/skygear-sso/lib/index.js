/* global window:false */
import skygear from 'skygear-core';
import cookies from 'js-cookie';
import { atob } from 'Base64';
/**
 * Calling plugin to retrieve auth url and open in popup
 *
 * @injectTo {AuthContainer} as loginOAuthProviderWithPopup
 * @param  {String} provider - name of provider, e.g. google, facebook
 * @param  {Object} options - options for generating auth_url
 * @return {Promise} promise
 *
 * @example
 * skygear.auth.loginOAuthProviderWithPopup('google').then(...);
 */
export function _loginOAuthProviderWithPopup(provider, options) {
  var newWindow = window.open('', '_blank', 'height=700,width=500');
  var newWindowObserver = new NewWindowObserver(newWindow);
  var authResultObserver = new PostAuthResultObserver();

  return this.container.lambda(`sso/${provider}/login_auth_url`, {
    ux_mode: 'js_popup', //eslint-disable-line
    ...options
  })
  .then((data) => {
    newWindow.location.href = data.auth_url; //eslint-disable-line
    return Promise.race([
      newWindowObserver.subscribe(),
      authResultObserver.subscribe()
    ]);
  }).then((result) => {
    newWindowObserver.unsubscribe();
    authResultObserver.unsubscribe();
    return this.container.auth._authResolve(result);
  });
}

/**
 * Calling plugin to retrieve and redirect to auth url
 *
 * @injectTo {AuthContainer} as loginOAuthProviderWithRedirect
 * @param  {String} provider - name of provider, e.g. google, facebook
 * @param  {Object} options - options for generating auth_url
 * @return {Promise} promise
 *
 * @example
 * skygear.auth.loginOAuthProviderWithRedirect('google').then(...);
 */
export function _loginOAuthProviderWithRedirect(provider, options) {
  return new Promise((resolve, reject) => {
    this.container.lambda(`sso/${provider}/login_auth_url`, {
      ux_mode: 'js_redirect', //eslint-disable-line
      ...options
    })
    .then((data) => {
      window.location.href = data.auth_url; //eslint-disable-line
      resolve();
    }, (err) => {
      reject(err);
    });
  });
}

/**
 * Auth flow handler script
 *
 * @injectTo {AuthContainer} as authHandler
 * @return {Promise} promise
 *
 * @example
 * skygear.auth.oauthHandler().then(...);
 */
export function _oauthHandler() {
  return new Promise((resolve, reject) => {
    let callbackURL = cookies.get('sso_callback_url');
    cookies.remove('sso_callback_url');
    this.container.lambda('sso/config')
    .then((data) => {
      let authorizedUrls = data.authorized_urls; //eslint-disable-line
      if (window.opener) {
        // popup
        _postSSOResultToWindow(window.opener, authorizedUrls);
        window.close();
        resolve();
      } else {
        // redirect_uri
        if (_validateCallbackUrl(callbackURL)) {
          window.location = callbackURL;
          resolve();
        } else {
          reject(`
            The domain is not authorized. Add it to the authorized callback
            urls list in portal. Domain: ${callbackURL}
          `);
        }
      }
    }, (err) => {
      reject(err);
    });
  });
}

function _postSSOResultToWindow(window, authorizedUrls) {
  let resultStr = cookies.get('sso_result');
  cookies.remove('sso_result');
  let result = resultStr && JSON.parse(atob(resultStr));
  if (!result) {
    reject('Fail to retrieve login result');
  }

  for (let u of authorizedUrls) {
    window.postMessage(result, u);
  }
}

function _validateCallbackUrl(url, authorizedUrls) {
  if (!url) {
    return false;
  }

  for (let u of authorizedUrls) {
    let regex = new RegExp(`^${u}`, 'i');
    if (url && url.match(regex)) {
      return true;
    }
  }

  return false;
}

class NewWindowObserver {
  constructor(newWindow) {
    this.newWindow = newWindow;
    this.timer = null;
  }

  subscribe() {
    return new Promise((resolve, reject) => {
      this.timer = window.setInterval(() => {
        if (this.newWindow.closed) {
          reject('User cancel the login flow');
        }
      }, 3000);
    });
  }

  unsubscribe() {
    if (this.timer) {
      window.clearInterval(this.timer);
    }
  }
}

class PostAuthResultObserver {
  constructor() {
    this.onMessageReceived = null;
  }

  subscribe() {
    return new Promise((resolve, reject) => {
      this.onMessageReceived = this._onMessageReceived
        .bind(this, resolve, reject);
      window.addEventListener('message', this.onMessageReceived);
    });
  }

  unsubscribe() {
    if (this.onMessageReceived) {
      window.removeEventListener('message', this.onMessageReceived);
    }
  }

  _onMessageReceived(resolve, reject, message) {
    resolve(message.data);
  }
}

/**
 * @private
 */
export const injectToContainer = (container = skygear) => {
  const authContainerPrototype = container.auth.constructor.prototype;
  authContainerPrototype.loginOAuthProviderWithPopup =
    _loginOAuthProviderWithPopup;
  authContainerPrototype.loginOAuthProviderWithRedirect =
    _loginOAuthProviderWithRedirect;
  authContainerPrototype.oauthHandler = _oauthHandler;
};
