'use strict';

import * as dependencies from'./dependencies';
const qsParse = dependencies.qsParse;
const qsStringify = dependencies.qsStringify;
const Microformats = dependencies.Microformats;
const objectToFormData = dependencies.objectToFormData;
const appendQueryString = dependencies.appendQueryString;
if (dependencies.FormData && !global.FormData) {
  global.FormData = dependencies.FormData;
}

const defaultSettings = {
  me: '',
  scope: 'post create delete update',
  token: '',
  authEndpoint: '',
  tokenEndpoint: '',
  micropubEndpoint: '',
};

const micropubError = (message, status = null, error = null) => {
  return {
    message: message,
    status: status,
    error: error,
  };
};

class Micropub {
  constructor(userSettings = {}) {
    this.options = Object.assign(defaultSettings, userSettings);

    // Bind all the things
    this.create = this.create.bind(this);
    this.update = this.update.bind(this);
    this.delete = this.delete.bind(this);
    this.undelete = this.undelete.bind(this);
    this.postMicropub = this.postMicropub.bind(this);
    this.checkRequiredOptions = this.checkRequiredOptions.bind(this);
    this.getAuthUrl = this.getAuthUrl.bind(this);
    this.getEndpointsFromUrl = this.getEndpointsFromUrl.bind(this);
  }

  /**
   * Checks to see if the given options are set
   * @param  {array} requirements An array of option keys to check
   * @return {object}             An object with boolean pass property and array missing property listing missing options
   */
  checkRequiredOptions(requirements) {
    let missing = [];
    let pass = true;
    for (var i = 0; i < requirements.length; i++) {
      const optionName = requirements[i];
      const option = this.options[optionName];
      if (!option) {
        pass = false;
        missing.push(optionName);
      }
    }
    return {
      pass: pass,
      missing: missing,
    }
  }

  /**
  let url = response.request.uri.href
    let options = {}
    options['html'] = body;
    options['baseUrl'] = url;
	*/
  
  
  /**
   * Get the various endpoints needed from the given url
   * @param  {string} url The url to scrape
   * @return {Promise}    Passes an object of endpoints on success: auth, token and micropub
   */
  getEndpointsFromUrl(url) {
    return new Promise((fulfill, reject) => {
      // Fetch the given url
      fetch(url)
        .then((res) => {
          if (!res.ok) {
            return reject(micropubError('Error getting page', res.status));
          }
		  let baseUrl = res.url
		  return res.text().then((html) => {
            // Parse the microformats data
            Microformats.get({html: html, baseUrl: baseUrl}, (err, mfData) => {
              if (err) {
                return reject(micropubError('Error parsing microformats data', null, err));
              }
            
              // Save necessary endpoints.
              if (mfData && mfData.rels && mfData.rels.authorization_endpoint && mfData.rels.token_endpoint && mfData.rels.micropub) {
                this.options.me = url;
                this.options.authEndpoint = mfData.rels.authorization_endpoint[0];
                this.options.tokenEndpoint = mfData.rels.token_endpoint[0];
                this.options.micropubEndpoint = mfData.rels.micropub[0];
            
                fulfill({
                  auth: this.options.authEndpoint,
                  token: this.options.tokenEndpoint,
                  micropub: this.options.micropubEndpoint,
                });
              }
              return reject(micropubError('Error getting microformats data'));
            });
          });  
        }).catch((err) => reject(micropubError('Error fetching url', null, err)));
    });
  }

  getToken(code) {
    return new Promise((fulfill, reject) => {
      const requirements = this.checkRequiredOptions(['me', 'state', 'scope', 'clientId', 'redirectUri', 'tokenEndpoint']);
      if (!requirements.pass) {
        return reject(micropubError('Missing required options: ' + requirements.missing.join(', ')));
      }

      const data = {
        grant_type: 'authorization_code',
        state: this.options.state,
        me: this.options.me,
        code: code,
        scope: this.options.scope,
        state: this.options.state,
        client_id: this.options.clientId,
        redirect_uri: this.options.redirectUri,
      };

      const request = {
        method: 'POST',
        body: qsStringify(data),
        headers: new Headers({
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'Accept': 'application/json',
        }),
        // mode: 'cors',
      };
      // This could maybe use the postMicropub method
      fetch(this.options.tokenEndpoint, request)
        .then((res) => {
          if (!res.ok) {
            return reject(micropubError('Error getting token', res.status));
          }
          const contentType = res.headers.get('Content-Type');
          if (contentType && contentType.indexOf('application/json') === 0) {
            return res.json()
          } else {
            return res.text();
          }
        })
        .then((result) => {
          // Parse the response from the indieauth server
          if (typeof result === 'string') {
            result = qsParse(result);
          }
          if (result.error_description) {
            return reject(micropubError(result.error_description));
          } else if (result.error) {
            return reject(micropubError(result.error));
          }
          if (!result.me || !result.scope || !result.access_token) {
            return reject(micropubError('The token endpoint did not return the expected parameters'));
          }
          // Check me is the same (removing any trailing slashes)
          if (result.me && result.me.replace(/\/+$/, '') !== this.options.me.replace(/\/+$/, '')) {
            return reject(micropubError('The me values did not match'));
          }
          // Check scope matches (not reliable)
          // console.log(result.scope);
          // console.log(this.options.scope);
          // if (result.scope && result.scope !== this.options.scope) {
          //   reject('The scope values did not match');
          // }
          // Successfully got the token
          this.options.token = result.access_token;
          fulfill(result.access_token);
        })
        .catch((err) => reject(micropubError('Error requesting token endpoint', null, err)));
    });
  }

  /**
   * Get the authentication url based on the set options
   * @return {string|boolean} The authentication url or false on missing options
   */
  getAuthUrl() {
    return new Promise((fulfill, reject) => {
      let requirements = this.checkRequiredOptions(['me', 'state']);
      if (!requirements.pass) {
        return reject(micropubError('Missing required options: ' + requirements.missing.join(', ')));
      }
      this.getEndpointsFromUrl(this.options.me)
        .then(() => {
          let requirements = this.checkRequiredOptions(['me', 'state', 'scope', 'clientId', 'redirectUri']);
          if (!requirements.pass) {
            return reject(micropubError('Missing required options: ' + requirements.missing.join(', ')));
          }
          const authParams = {
            me: this.options.me,
            client_id: this.options.clientId,
            redirect_uri: this.options.redirectUri,
            response_type: 'code',
            scope: this.options.scope,
            state: this.options.state,
          };

          fulfill(this.options.authEndpoint + '?' + qsStringify(authParams));
        })
        .catch((err) => reject(micropubError('Error getting auth url', null, err)));
    });
  }

  verifyToken() {
    return new Promise((fulfill, reject) => {
      const requirements = this.checkRequiredOptions(['token', 'micropubEndpoint']);
      if (!requirements.pass) {
        return reject(micropubError('Missing required options: ' + requirements.missing.join(', ')));
      }

      const request = {
        method: 'GET',
        headers: new Headers({
          'Authorization': 'Bearer ' + this.options.token,
        }),
      };

      fetch(this.options.micropubEndpoint, request)
        .then((res) => {
          if (res.ok) {
            return fulfill(true);
          } else {
            return reject(micropubError('Error verifying token', res.status));
          }
        })
        .catch((err) => reject(micropubError('Error verifying token', null, err)));
    });
  }

  create(post, type = 'json') {
    return this.postMicropub(post, type);
  }

  update(url, update) {
    return this.postMicropub(Object.assign({
      action: 'update',
      url: url,
    }, update));
  }

  delete(url) {
    return this.postMicropub({
      action: 'delete',
      url: url,
    })
  }

  undelete(url) {
    return this.postMicropub({
      action: 'undelete',
      url: url,
    })
  }

  postMicropub(object, type = 'json') {
    return new Promise((fulfill, reject) => {
      const requirements = this.checkRequiredOptions(['token', 'micropubEndpoint']);
      if (!requirements.pass) {
        return reject(micropubError('Missing required options: ' + requirements.missing.join(', ')));
      }

      let request = {
        method: 'POST',
      };

      if (type == 'json') {
        request.body = JSON.stringify(object);
        request.headers = new Headers({
          'Authorization': 'Bearer ' + this.options.token,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        });
      } else if (type == 'form') {
        request.body = qsStringify(object);
        request.headers = new Headers({
          'Authorization': 'Bearer ' + this.options.token,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'Accept': 'application/json',
        });
      } else if (type == 'multipart') {
        request.body = objectToFormData(object);
        request.headers = new Headers({
          'Authorization': 'Bearer ' + this.options.token,
          'Content-Type': undefined,
          'Accept': 'application/json',
        });
      }

      fetch(this.options.micropubEndpoint, request)
        .then((res) => {
          if (!res.ok) {
            return reject(micropubError('Error with micropub request', res.status));
          }
          const location = res.headers.get('Location') || res.headers.get('location');
          if (location) {
            return fulfill(location);
          }
          const contentType = res.headers.get('Content-Type');
          if (contentType && contentType.indexOf('application/json') === 0) {
            return res.json()
          } else {
            return res.text();
          }
        })
        .then((result) => {
          if (typeof result === 'string') {
            result = qsParse(result);
          }
          if (result.error_description) {
            return reject(micropubError(result.error_description));
          } else if (result.error) {
            return reject(micropubError(result.error));
          } else {
            return fulfill(result);
          }
        })
        .catch((err) => reject(micropubError('Error sending request', null, err)));
    });
  }

  postMedia(file) {
    return new Promise((fulfill, reject) => {
      const requirements = this.checkRequiredOptions(['token', 'mediaEndpoint']);
      if (!requirements.pass) {
        return reject(micropubError('Missing required options: ' + requirements.missing.join(', ')));
      }

      let request = {
        method: 'POST',
        body: objectToFormData({file: file}),
        headers: new Headers({
          'Authorization': 'Bearer ' + this.options.token,
          'Content-Type': undefined,
          'Accept': 'application/json',
        }),
      };

      fetch(this.options.mediaEndpoint, request)
        .then((res) => {
          if (res.status !== 201) {
            return reject(micropubError('Error creating media', res.status));
          }
          const location = res.headers.get('Location') || res.headers.get('location');
          if (location) {
            return fulfill(location);
          } else {
            return reject(micropubError('Media endpoint did not return a location', res.status));
          }
        })
        .catch((err) => reject(micropubError('Error sending request')));
    });
  }

  query(type) {
    return new Promise((fulfill, reject) => {
      const requirements = this.checkRequiredOptions(['token', 'micropubEndpoint']);
      if (!requirements.pass) {
        return reject(micropubError('Missing required options: ' + requirements.missing.join(', ')));
      }

      const url = appendQueryString(this.options.micropubEndpoint, {q: type});

      const request = {
        method: 'GET',
        headers: new Headers({
          'Authorization': 'Bearer ' + this.options.token,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'Accept': 'application/json',
        }),
        // mode: 'cors',
      };

      fetch(url, request)
        .then((res) => {
          if (!res.ok) {
            return reject(micropubError('Error getting ' + type, res.status));
          }
          return res.json()
        })
        .then((json) => fulfill(json))
        .catch((err) => reject(micropubError('Error getting ' + type, null, err)));
    });
  }

  querySource(url, properties = []) {
    return new Promise((fulfill, reject) => {
      const requirements = this.checkRequiredOptions(['token', 'micropubEndpoint']);
      if (!requirements.pass) {
        return reject(micropubError('Missing required options: ' + requirements.missing.join(', ')));
      }

      url = appendQueryString(this.options.micropubEndpoint, {q: 'source', url: url, properties: properties});

      const request = {
        method: 'GET',
        headers: new Headers({
          'Authorization': 'Bearer ' + this.options.token,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'Accept': 'application/json',
        }),
        // mode: 'cors',
      };

      fetch(url, request)
        .then((res) => {
          if (!res.ok) {
            return reject(micropubError('Error getting source', res.status));
          }
          return res.json()
        })
        .then((json) => fulfill(json))
        .catch((err) => reject(micropubError('Error getting source', null, err)));
    });
  }
}

export default Micropub;
