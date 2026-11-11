const {test, expect} = require('@playwright/test');

for (const reducedMotion of ['no-preference', 'reduce']) {
  test('island and savings milestones with motion ' + reducedMotion, async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.emulateMedia({reducedMotion});
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto('/finance-center.html');
    await expect(page.locator('.cozy-backdrop')).toBeVisible();
    await expect.poll(() => page.locator('.cozy-backdrop').evaluate(img => img.naturalWidth)).toBe(764);
    await expect(page.locator('[data-scene-motion]')).toHaveCount(0);
    const scene = page.locator('.cozy-scene');
    const art = page.locator('.cozy-art');
    const mobileScene = await scene.boundingBox();
    expect((await art.boundingBox()).width).toBeGreaterThan(mobileScene.width*1.3);
    expect(mobileScene.height).toBeGreaterThan(mobileScene.width*337/764);
    const stride = await page.locator('.cozy-actor').first().evaluate(node => {
      const frames = getComputedStyle(node,'::after');
      return {asset:frames.backgroundImage, animation:frames.animationName};
    });
    expect(stride.asset).toContain('traveler-steps.webp');
    expect(stride.animation.includes('cozy-stride')).toBe(reducedMotion !== 'reduce');
    await page.setViewportSize({width:1280,height:844});
    await expect.poll(() => scene.evaluate(node => {
      const art = node.getBoundingClientRect();
      const summary = node.nextElementSibling.getBoundingClientRect();
      return Math.abs(art.height-art.width/2)<2 &&
        art.width<=1000 && art.width>summary.width && summary.right<art.left &&
        Math.abs(art.bottom-summary.bottom)<0.5;
    })).toBe(true);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => {
      FinanceCore.addAccount({name:'RPG Bank', type:'銀行帳戶', currency:'TWD', openingBalance:1000});
      FinanceUpgrades.saveGoal({name:'RPG Trip', targetAmount:1000, currentAmount:400, linkedAccount:'RPG Bank'});
      window.travelerMoves = 0;
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.matches('.cozy-traveler')) window.travelerMoves++;
        return animate.apply(this, args);
      };
    });
    await page.locator('.cozy-links [data-go="analysis/planning"]').click();
    await expect.poll(() => page.locator('.cozy-backdrop').evaluate(img => img.naturalWidth)).toBe(764);
    const traveler = page.locator('.cozy-traveler');
    await expect(traveler).toHaveAttribute('data-milestone', '4');
    const trail = await scene.boundingBox();
    for (const marker of await page.locator('.cozy-stop').all()) {
      const box = await marker.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(trail.x);
      expect(box.x+box.width).toBeLessThanOrEqual(trail.x+trail.width);
    }
    await page.locator('[data-edit-goal]').first().click();
    await page.locator('#goalForm [name=currentAmount]').fill('600');
    await page.locator('#goalForm button[type=submit]').click();
    await expect(traveler).toHaveAttribute('data-milestone', '6');
    await expect(page.locator('.cozy-panel p.money-value')).toContainText('60%');
    await expect(page.getByText('距離下一站還差')).toContainText('100');
    await expect(page.locator('.cozy-stop.reached')).toHaveCount(7);
    expect(await page.evaluate(() => window.travelerMoves)).toBe(reducedMotion === 'reduce' ? 0 : 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload();
    await expect(traveler).toHaveAttribute('data-milestone', '6');
  });
}

