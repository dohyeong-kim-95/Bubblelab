export class Router {
  constructor() {
    this.routes = {};
    this.currentView = null;
    window.addEventListener('hashchange', () => this.handleRoute());
  }

  addRoute(path, viewFactory) {
    this.routes[path] = viewFactory;
  }

  handleRoute() {
    const hash = window.location.hash || '#/';
    const [path, ...paramParts] = hash.slice(2).split('/');
    const routeKey = '/' + path;
    const params = paramParts.join('/');

    if (this.currentView && typeof this.currentView.destroy === 'function') {
      this.currentView.destroy();
    }

    const viewFactory = this.routes[routeKey] || this.routes['/'];
    if (viewFactory) {
      this.currentView = viewFactory(params);
      this.currentView.render();
    }
  }

  navigate(path) {
    window.location.hash = '#' + path;
  }

  start() {
    this.handleRoute();
  }
}

export const router = new Router();
